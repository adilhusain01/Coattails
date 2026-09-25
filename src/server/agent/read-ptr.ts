import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { PDFDocument } from "pdf-lib"
import { SarvamAIClient } from "sarvamai"
import OpenAI from "openai"
import { extractText, getDocumentProxy } from "unpdf"
import { z } from "zod"

const MODEL = "sarvam-105b"
/** Primary reader: reads the PDF itself, typed or scanned. */
const LUNA = process.env.READER_MODEL ?? "openai/gpt-6-luna"
/** Second opinion for scans the primary reader marks illegible. */
const FALLBACK = process.env.READER_FALLBACK_MODEL ?? "google/gemini-3.8-flash"

const PtrLine = z.object({
  owner: z.enum(["self", "spouse", "joint", "dependent"]).describe("SP=spouse, JT=joint, DC=dependent, blank=self"),
  assetName: z.string().describe("Asset name exactly as written, without the ticker and asset-type tag"),
  ticker: z.string().nullable().describe("Ticker from the parentheses, uppercase; null if none is written"),
  assetType: z.string().describe("Asset-type code from the brackets, e.g. ST, OP, GS, CS; empty if none"),
  side: z.enum(["buy", "sell", "exchange"]).describe("P=buy, S or S (partial)=sell, E=exchange"),
  tradeDate: z.string().describe("Transaction date, YYYY-MM-DD"),
  notificationDate: z.string().nullable().describe("Notification date, YYYY-MM-DD, null if blank"),
  amountLow: z.number().nullable().describe("Lower bound of the amount range in USD"),
  amountHigh: z.number().nullable().describe("Upper bound of the amount range in USD; null for 'Over $X'"),
  description: z.string().nullable().describe("The Description line, e.g. option strike and expiry, if present"),
})

const PtrDoc = z.object({
  filerName: z.string().describe("Filer name as written, without the 'Hon.' prefix"),
  stateDistrict: z.string().nullable(),
  signedDate: z.string().nullable().describe("Digital signature or signing date, YYYY-MM-DD"),
  legible: z.boolean().describe("False if the text is too garbled to read the transactions reliably"),
  transactions: z.array(PtrLine),
})

export type PtrExtraction = z.infer<typeof PtrDoc> & { readBy: string }

const SYSTEM = `You transcribe US House Periodic Transaction Reports (PTRs) into JSON.
The input is text extracted from the PDF form; column headers and small caps may be garbled.
Each transaction row has: owner code (SP, JT, DC or blank), asset name with ticker in parentheses
and an asset-type code in brackets such as [ST] or [OP], a transaction type (P purchase, S sale,
S (partial), E exchange), transaction date, notification date, and an amount range such as
$1,001 - $15,000. A "D:" line under a row is its description (e.g. option strike and expiry).
Copy what the form says; never invent trades. Include every transaction row. Set legible=false
if the text is too damaged to read reliably. Reply with the JSON object only.`

let client: SarvamAIClient | null = null
function sarvam() {
  const key = process.env.SARVAM_API_KEY
  if (!key) throw new Error("SARVAM_API_KEY is not set")
  client ??= new SarvamAIClient({ apiSubscriptionKey: key })
  return client
}

/** Text layer of an e-filed PDF; empty for paper scans. */
async function pdfText(pdf: Buffer) {
  const doc = await getDocumentProxy(new Uint8Array(pdf))
  const { text } = await extractText(doc, { mergePages: true })
  return text.replace(/\u0000/g, "").trim()
}

/** OCR for up to 10 pages, through Sarvam Document Intelligence (markdown output). */
async function ocrChunk(pdf: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), "coattails-ptr-"))
  try {
    const input = join(dir, "filing.pdf")
    await writeFile(input, pdf)
    const job = await sarvam().documentIntelligence.createJob({ language: "en-IN", outputFormat: "md" })
    await job.uploadFile(input)
    await job.start()
    await job.waitUntilComplete()
    const out = await job.downloadOutput(join(dir, "out.zip"))
    // The output is a zip holding document.md plus per-page layout JSON.
    const bytes = new Uint8Array(await readFile(out))
    const files = unzipSync(bytes)
    const md = Object.keys(files).find((f) => f.endsWith(".md"))
    if (!md) throw new Error("Document Intelligence returned no markdown")
    return strFromU8(files[md])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function parseJson(content: string) {
  const trimmed = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  return JSON.parse(trimmed.slice(start, end + 1))
}

const OCR_MAX_PAGES = 10

/** OCR for scanned paper filings. Document Intelligence takes 10 pages per job, so longer scans are split. */
async function ocr(pdf: Buffer) {
  const src = await PDFDocument.load(new Uint8Array(pdf), { ignoreEncryption: true })
  const pages = src.getPageCount()
  if (pages <= OCR_MAX_PAGES) return ocrChunk(new Uint8Array(pdf))
  const parts: string[] = []
  for (let start = 0; start < pages; start += OCR_MAX_PAGES) {
    const chunk = await PDFDocument.create()
    const indices = Array.from({ length: Math.min(OCR_MAX_PAGES, pages - start) }, (_, i) => start + i)
    for (const page of await chunk.copyPages(src, indices)) chunk.addPage(page)
    parts.push(await ocrChunk(await chunk.save()))
  }
  return parts.join("\n\n")
}

/** The filing's text: its text layer when e-filed, OCR when it is a paper scan. */
export async function filingText(pdf: Buffer) {
  const text = await pdfText(pdf).catch(() => "")
  if (text.length >= 200) return { text, readBy: "sarvam" }
  return { text: await ocr(pdf), readBy: "sarvam+ocr" }
}

// OpenRouter (GPT-6 Luna) ----------------------------------------------------------------------

const LUNA_SYSTEM = `You transcribe US House Periodic Transaction Reports (PTRs) into JSON.
The attached PDF is either a typed e-filed form or a scan of a paper form, sometimes handwritten.
Each transaction row has: owner code (SP, JT, DC or blank), asset name with ticker in parentheses
and an asset-type code in brackets such as [ST] or [OP], a transaction type (P purchase, S sale,
S (partial), E exchange), transaction date, notification date, and an amount range such as
$1,001 - $15,000. On paper forms the amount is a checked column; read which column is marked.
A "D:" line under a row is its description (e.g. option strike and expiry). Copy what the form
says and never invent trades. Include every transaction row on every page. Set legible=false if
the scan is too damaged to read the transactions reliably.`

let openrouter: OpenAI | null = null
function router() {
  openrouter ??= new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://coattails.adilhusain.xyz", "X-Title": "Coattails" },
    timeout: 180_000,
    maxRetries: 1,
  })
  return openrouter
}

/** Strict JSON schema: every object closed and every property required, as strict mode expects. */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema)
  if (!node || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) if (k !== "$schema") out[k] = strictSchema(v)
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false
    out.required = Object.keys(out.properties as object)
  }
  return out
}
const PTR_SCHEMA = strictSchema(z.toJSONSchema(PtrDoc)) as Record<string, unknown>

async function readWithModel(pdf: Buffer, model: string) {
  const request = {
    model,
    max_tokens: 16000,
    temperature: 0,
    // Transcription needs little thinking; minimal effort keeps reads fast and output tokens small.
    reasoning: { effort: "minimal" },
    // Luna and Gemini read PDFs natively, so the raw file goes to the model with no OCR step.
    plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
    response_format: { type: "json_schema", json_schema: { name: "ptr", strict: true, schema: PTR_SCHEMA } },
    messages: [
      { role: "system", content: LUNA_SYSTEM },
      {
        role: "user",
        content: [
          { type: "file", file: { filename: "ptr.pdf", file_data: `data:application/pdf;base64,${pdf.toString("base64")}` } },
          { type: "text", text: "Transcribe this Periodic Transaction Report." },
        ],
      },
    ],
  }
  // OpenRouter's reasoning and plugins fields are not in the OpenAI SDK's types.
  const response = await router().chat.completions.create(request as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming)
  const choice = response.choices[0]
  if (choice.finish_reason === "length") throw new Error(`${model} ran out of tokens reading the filing`)
  const content = choice.message.content
  if (!content) throw new Error(`${model} returned an empty reply`)
  const parsed = PtrDoc.safeParse(parseJson(content))
  if (!parsed.success) throw new Error(`${model} reply did not match the schema: ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

async function readPtrOpenRouter(pdf: Buffer): Promise<PtrExtraction> {
  const doc = await readWithModel(pdf, LUNA)
  if (doc.legible || FALLBACK === LUNA) return { ...doc, readBy: LUNA.split("/").pop()! }
  // A scan the primary model could not read: one retry on the fallback model.
  const second = await readWithModel(pdf, FALLBACK)
  return { ...second, readBy: FALLBACK.split("/").pop()! }
}

/** Reads one PTR PDF into structured transactions: GPT-6 Luna via OpenRouter, else Sarvam. */
export async function readPtr(pdf: Buffer): Promise<PtrExtraction> {
  if (process.env.OPENROUTER_API_KEY) return readPtrOpenRouter(pdf)
  return readPtrSarvam(pdf)
}

async function readPtrSarvam(pdf: Buffer): Promise<PtrExtraction> {
  const { text, readBy } = await filingText(pdf)

  const response = await sarvam().chat.completions(
    {
      model: MODEL,
      temperature: 0,
      max_tokens: 16000,
      // Transcription needs no reasoning; with it off a filing reads in seconds instead of minutes.
      reasoning_effort: null as unknown as undefined,
      response_format: {
        type: "json_schema",
        json_schema: { name: "ptr", schema: z.toJSONSchema(PtrDoc) as Record<string, unknown>, strict: true },
      },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Periodic Transaction Report text:\n\n${text.slice(0, 60_000)}` },
      ],
    },
    { timeoutInSeconds: 180, maxRetries: 1 },
  )
  const choice = response.choices[0]
  if (choice.finish_reason === "length") throw new Error("Sarvam ran out of tokens reading the filing")
  const content = choice.message.content
  if (!content) throw new Error("Sarvam returned an empty reply")
  const parsed = PtrDoc.safeParse(parseJson(content))
  if (!parsed.success) throw new Error(`Sarvam reply did not match the schema: ${parsed.error.issues[0]?.message}`)
  return { ...parsed.data, readBy }
}
