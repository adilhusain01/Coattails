import type { NextRequest } from "next/server"
import { fail, handle, ok } from "@/server/http"
import { sourceProfile } from "@/server/queries"

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/source/[slug]">) {
  return handle(async () => {
    const { slug } = await ctx.params
    const profile = await sourceProfile(slug)
    return profile ? ok(profile) : fail("Not found", 404)
  })
}
