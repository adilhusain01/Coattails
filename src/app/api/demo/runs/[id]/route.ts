import type { NextRequest } from "next/server"
import { fail, handle, ok } from "@/server/http"
import { getRun } from "@/server/demo"

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/demo/runs/[id]">) {
  return handle(async () => {
    const run = getRun((await ctx.params).id)
    return run ? ok(run) : fail("Run not found", 404)
  })
}
