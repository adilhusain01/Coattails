import { handle, ok } from "@/server/http"
import { receiptsLog } from "@/server/queries"

export async function GET() {
  return handle(async () => ok(await receiptsLog(60)))
}
