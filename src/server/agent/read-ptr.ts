import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"

const MODEL = "claude-opus-5"

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
  legible: z.boolean().describe("False if the scan is too degraded to read the transactions reliably"),
  transactions: z.array(PtrLine),
})

export type PtrExtraction = z.infer<typeof PtrDoc>

const SYSTEM = `You transcribe US House Periodic Transaction Reports (PTRs) into structured data.
Copy what the form says; never infer trades that are not written on it. Scanned and handwritten
forms are common: read them carefully, and set legible=false rather than guessing when a line
cannot be read. Amounts are the disclosure ranges printed on the form ($1,001 - $15,000,
$15,001 - $50,000, and so on). Include every transaction row, including options, bonds and funds.`

let client: Anthropic | null = null

/** Reads one PTR PDF with Claude and returns its transactions. */
export async function readPtr(pdf: Buffer): Promise<PtrExtraction> {
  client ??= new Anthropic()

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(PtrDoc) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: "Transcribe this Periodic Transaction Report." },
        ],
      },
    ],
  })

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to read the filing (${response.stop_details?.category ?? "no category"})`)
  }
  if (!response.parsed_output) {
    throw new Error(`Claude returned no parseable output (stop_reason ${response.stop_reason})`)
  }
  return response.parsed_output
}
