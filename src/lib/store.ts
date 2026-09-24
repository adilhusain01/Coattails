"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type FollowPrefs = {
  perTradeUsd: number
  budgetUsd: number
  /** Fraction below the peak price; null turns the trailing stop off. */
  trailingStopPct: number | null
  /** Days before a position is sold without a reported sale; null turns it off. */
  maxHoldDays: number | null
  setPerTrade: (v: number) => void
  setBudget: (v: number) => void
  setTrailingStop: (v: number | null) => void
  setMaxHold: (v: number | null) => void
}

/** Remembers the amounts a visitor last chose so the next follow starts from them. */
export const useFollowPrefs = create<FollowPrefs>()(
  persist(
    (set) => ({
      perTradeUsd: 10,
      budgetUsd: 50,
      trailingStopPct: 0.15,
      maxHoldDays: 90,
      setPerTrade: (perTradeUsd) => set((s) => ({ perTradeUsd, budgetUsd: Math.max(s.budgetUsd, perTradeUsd) })),
      setBudget: (budgetUsd) => set({ budgetUsd }),
      setTrailingStop: (trailingStopPct) => set({ trailingStopPct }),
      setMaxHold: (maxHoldDays) => set({ maxHoldDays }),
    }),
    {
      name: "coattails:follow-prefs",
      storage: createJSONStorage(() => {
        try {
          return localStorage
        } catch {
          return sessionStorage
        }
      }),
    },
  ),
)
