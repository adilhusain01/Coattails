"use client"

import { createClient } from "@solana/kit"
import { solanaRpc } from "@solana/kit-plugin-rpc"
import { walletSigner } from "@solana/kit-plugin-wallet"
import { CHAIN, PUBLIC_RPC_URL } from "@/lib/cluster"

/**
 * One browser client for the app. The connected wallet is payer and identity, but Coattails
 * never has the wallet pay: the server builds every transaction with the agent as fee payer
 * and the wallet only adds its signature.
 */
export const client = createClient()
  .use(walletSigner({ chain: CHAIN }))
  .use(solanaRpc({ rpcUrl: PUBLIC_RPC_URL, transactionConfig: { version: 0 } }))

export type AppClient = typeof client
