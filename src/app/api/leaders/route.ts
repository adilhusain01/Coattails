import { handle, ok } from "@/server/http"
import { leaderboard } from "@/server/queries"

export async function GET() {
  return handle(async () => ok(await leaderboard()))
}
