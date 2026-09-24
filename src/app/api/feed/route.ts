import { handle, ok } from "@/server/http"
import { latestFilings } from "@/server/queries"

export async function GET() {
  return handle(async () => ok(await latestFilings(30)))
}
