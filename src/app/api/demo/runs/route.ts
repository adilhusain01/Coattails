import { fail, handle, ok } from "@/server/http"
import { startRun, type ScenarioKey } from "@/server/demo"

const KEYS: ScenarioKey[] = ["reported_sale", "trailing_stop", "time_limit", "budget"]

export async function POST(req: Request) {
  return handle(async () => {
    const { scenario } = (await req.json()) as { scenario?: ScenarioKey }
    if (!scenario || !KEYS.includes(scenario)) return fail("Unknown scenario")
    const { run, joined } = await startRun(scenario)
    return ok({ id: run.id, joined })
  })
}
