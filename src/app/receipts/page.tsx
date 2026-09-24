import type { Metadata } from "next"
import { ReceiptsView } from "@/components/views/receipts-view"
import { receiptsLog } from "@/server/queries"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Receipts" }

export default async function ReceiptsPage() {
  return <ReceiptsView log={await receiptsLog(60)} />
}
