import type { Metadata } from "next"
import { MembersView } from "@/components/views/members-view"
import { leaderboard } from "@/server/queries"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Members" }

export default async function MembersPage() {
  return <MembersView leaders={await leaderboard()} />
}
