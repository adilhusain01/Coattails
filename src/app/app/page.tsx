import { HomeView } from "@/components/views/home-view"
import { latestFilings, leaderboard } from "@/server/queries"

export const dynamic = "force-dynamic"

export default async function Home() {
  const [filings, leaders] = await Promise.all([latestFilings(30), leaderboard()])
  return <HomeView filings={filings} leaders={leaders} />
}
