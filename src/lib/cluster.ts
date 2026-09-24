export type Cluster = "devnet" | "mainnet-beta"

export const CLUSTER: Cluster = process.env.NEXT_PUBLIC_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet"

export const CHAIN = CLUSTER === "mainnet-beta" ? "solana:mainnet" : "solana:devnet"

export const PUBLIC_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (CLUSTER === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com")

export function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`
}

export function explorerAddress(address: string) {
  return `https://explorer.solana.com/address/${address}${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`
}
