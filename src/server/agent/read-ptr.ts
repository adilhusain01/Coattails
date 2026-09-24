import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SarvamAIClient } from "sarvamai"
import { extractText, getDocumentProxy } from "unpdf"
import { z } from "zod"

const MODEL = "sarvam-105b"

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

/** OCR for scanned paper filings, through Sarvam Document Intelligence (markdown output). */
async function ocr(pdf: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "coattails-ptr-"))
  try {
    const input = join(dir, "filing.pdf")
    await writeFile(input, pdf)
    const job = await sarvam().documentIntelligence.createJob({ language: "en-IN", outputFormat: "md" })
    await job.uploadFile(input)
    await job.start()
    await job.waitUntilComplete()
    const out = await job.downloadOutput(join(dir, "out"))
    return await readFile(out, "utf8").catch(async () => {
      // downloadOutput may return a directory or zip path depending on SDK version.
      const { readdir } = await import("node:fs/promises")
      const files = await readdir(join(dir, "out"), { recursive: true })
      const md = files.find((f) => String(f).endsWith(".md"))
      if (!md) throw new Error("Document Intelligence returned no markdown")
      return readFile(join(dir, "out", String(md)), "utf8")
    })
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

/** Reads one PTR PDF into structured transactions. */
export async function readPtr(pdf: Buffer): Promise<PtrExtraction> {
  let text = await pdfText(pdf).catch(() => "")
  let readBy = "sarvam"
  if (text.length < 200) {
    text = await ocr(pdf)
    readBy = "sarvam+ocr"
  }

  const response = await sarvam().chat.completions({
    model: MODEL,
    temperature: 0,
    max_tokens: 8000,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: { name: "ptr", schema: z.toJSONSchema(PtrDoc) as Record<string, unknown>, strict: true },
    },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Periodic Transaction Report text:\n\n${text.slice(0, 60_000)}` },
    ],
  })
  const choice = response.choices[0]
  if (choice.finish_reason === "length") throw new Error("Sarvam ran out of tokens reading the filing")
  const content = choice.message.content
  if (!content) throw new Error("Sarvam returned an empty reply")
  const parsed = PtrDoc.safeParse(parseJson(content))
  if (!parsed.success) throw new Error(`Sarvam reply did not match the schema: ${parsed.error.issues[0]?.message}`)
  return { ...parsed.data, readBy }
}
