"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type FollowPrefs = {
  perTradeUsd: number
  budgetUsd: number
  setPerTrade: (v: number) => void
  setBudget: (v: number) => void
}

/** Remembers the amounts a visitor last chose so the next follow starts from them. */
export const useFollowPrefs = create<FollowPrefs>()(
  persist(
    (set) => ({
      perTradeUsd: 10,
      budgetUsd: 50,
      setPerTrade: (perTradeUsd) => set((s) => ({ perTradeUsd, budgetUsd: Math.max(s.budgetUsd, perTradeUsd) })),
      setBudget: (budgetUsd) => set({ budgetUsd }),
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
