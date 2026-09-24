"use client"

import { useQuery } from "@tanstack/react-query"
import type { ExecutionView, FilingView, LeaderRow, SourceView } from "@/server/queries"
import { api } from "@/lib/wallet-tx"

export const keys = {
  feed: ["feed"] as const,
  leaders: ["leaders"] as const,
  receipts: ["receipts"] as const,
  source: (slug: string) => ["source", slug] as const,
  me: (wallet: string) => ["me", wallet] as const,
}

export function useFeed(initialData?: FilingView[]) {
  return useQuery({ queryKey: keys.feed, queryFn: () => api<FilingView[]>("/api/feed"), initialData, refetchInterval: 30_000 })
}

export function useLeaders(initialData?: LeaderRow[]) {
  return useQuery({ queryKey: keys.leaders, queryFn: () => api<LeaderRow[]>("/api/leaders"), initialData, refetchInterval: 60_000 })
}

export type ReceiptsLog = { filings: FilingView[]; executions: ExecutionView[] }

export function useReceipts(initialData?: ReceiptsLog) {
  return useQuery({ queryKey: keys.receipts, queryFn: () => api<ReceiptsLog>("/api/receipts"), initialData, refetchInterval: 10_000 })
}

export type SourceProfile = { source: SourceView; filings: FilingView[]; followers: number }

export function useSource(slug: string, initialData?: SourceProfile) {
  return useQuery({ queryKey: keys.source(slug), queryFn: () => api<SourceProfile>(`/api/source/${slug}`), initialData, refetchInterval: 30_000 })
}

export type WalletState = {
  follows: { id: number; perTradeUsd: number; autoSell: boolean; active: boolean; createdAt: string; source: SourceView }[]
  executions: ExecutionView[]
  usdc: { balance: number; allowance: number; mint: string; cluster: string }
}

export function useMe(wallet: string | undefined) {
  return useQuery({
    queryKey: keys.me(wallet ?? ""),
    queryFn: () => api<WalletState>(`/api/me?wallet=${wallet}`),
    enabled: !!wallet,
    refetchInterval: 10_000,
  })
}
