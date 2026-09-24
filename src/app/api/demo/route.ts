import { handle, ok } from "@/server/http"
import { activeRun, scenarios } from "@/server/demo"

export async function GET() {
  return handle(async () => ok({ scenarios: await scenarios(), active: activeRun()?.id ?? null }))
}
