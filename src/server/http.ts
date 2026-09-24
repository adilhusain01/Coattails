import { NextResponse } from "next/server"

export function ok(data: unknown) {
  return NextResponse.json(data)
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Runs a handler and turns thrown errors into a JSON error with a readable message. */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn()
  } catch (err) {
    console.error(err)
    return fail(err instanceof Error ? err.message : "Something went wrong", 500)
  }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export function isWallet(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value)
}
