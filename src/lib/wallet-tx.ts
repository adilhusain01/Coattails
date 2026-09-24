"use client"

import {
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  type Transaction,
  type TransactionModifyingSigner,
  type TransactionSigner,
} from "@solana/kit"

type SignableTransaction = Parameters<TransactionModifyingSigner["modifyAndSignTransactions"]>[0][number]

export class ApiError extends Error {}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`)
  return data
}

async function signWithWallet(signer: TransactionSigner, tx: SignableTransaction): Promise<Transaction> {
  if (isTransactionModifyingSigner(signer)) {
    const [signed] = await signer.modifyAndSignTransactions([tx])
    return signed
  }
  if (isTransactionPartialSigner(signer)) {
    const [sigs] = await signer.signTransactions([tx as Parameters<typeof signer.signTransactions>[0][number]])
    return { ...tx, signatures: { ...tx.signatures, ...sigs } }
  }
  throw new Error("This wallet cannot sign transactions")
}

/**
 * Server builds the transaction with Coattails as fee payer, the wallet signs, and the server
 * co-signs and sends. The follower never needs SOL.
 */
export async function signAndSubmit(opts: {
  signer: TransactionSigner
  wallet: string
  buildPath: string
  buildBody: Record<string, unknown>
  intent: Record<string, unknown>
}) {
  const { tx } = await api<{ tx: string }>(opts.buildPath, { wallet: opts.wallet, ...opts.buildBody })
  // The server compiled it with a blockhash lifetime and within the size limit.
  const unsigned = getTransactionDecoder().decode(getBase64Encoder().encode(tx)) as SignableTransaction
  const signed = await signWithWallet(opts.signer, unsigned)
  const { sig } = await api<{ sig: string }>("/api/follow/submit", {
    wallet: opts.wallet,
    signed: getBase64EncodedWireTransaction(signed),
    intent: opts.intent,
  })
  return sig
}

export function userRejected(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return /reject|denied|cancel/i.test(msg)
}
