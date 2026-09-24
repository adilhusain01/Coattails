import type { Metadata } from "next"
import { MembersView } from "@/components/views/members-view"
import { leaderboard } from "@/server/queries"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "People to mirror" }

export default async function MembersPage() {
  return <MembersView leaders={await leaderboard()} />
}
