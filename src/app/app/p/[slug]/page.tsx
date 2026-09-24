import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SourceView } from "@/components/views/source-view"
import { sourceProfile } from "@/server/queries"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: PageProps<"/app/p/[slug]">): Promise<Metadata> {
  const profile = await sourceProfile((await params).slug)
  return { title: profile ? `Mirror ${profile.source.name}` : "Member" }
}

export default async function SourcePage({ params }: PageProps<"/app/p/[slug]">) {
  const { slug } = await params
  const profile = await sourceProfile(slug)
  if (!profile) notFound()
  return <SourceView slug={slug} profile={profile} />
}
