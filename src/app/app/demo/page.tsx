import type { Metadata } from "next"
import { Suspense } from "react"
import { DemoView } from "@/components/views/demo-view"

export const metadata: Metadata = { title: "Demo" }

export default function DemoPage() {
  return (
    <Suspense>
      <DemoView />
    </Suspense>
  )
}
