import { differenceInCalendarDays } from "date-fns"

export function shortAddress(address: string, chars = 4) {
  return `${address.slice(0, chars)}..${address.slice(-chars)}`
}

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })

export function usd(value: number | null | undefined, digits: 0 | 2 = 2) {
  if (value == null || Number.isNaN(value)) return "-"
  return digits === 0 ? usd0.format(value) : usd2.format(value)
}

/** "$15K-$50K", the way disclosure forms state amounts. */
export function amountRange(low: number | null, high: number | null) {
  if (low == null && high == null) return "Undisclosed"
  if (low != null && high != null && low === high) return compact.format(low)
  if (high == null) return `Over ${compact.format(low!)}`
  return `${compact.format(low ?? 0)}-${compact.format(high)}`
}

export function pct(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "-"
  const fixed = (value * 100).toFixed(digits)
  if (Number(fixed) === 0) return `${(0).toFixed(digits)}%`
  return `${value > 0 ? "+" : ""}${fixed}%`
}

// Filing and trade dates are calendar days stored at UTC midnight; format them in UTC so every
// timezone (and the server render) shows the same day.
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const shortDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

export function day(date: Date | number | string) {
  return dayFmt.format(new Date(date))
}

export function shortDay(date: Date | number | string) {
  return shortDayFmt.format(new Date(date))
}

/** Days between the trade and its public disclosure. */
export function lagDays(tradedAt: Date | number | string, disclosedAt: Date | number | string) {
  return differenceInCalendarDays(new Date(disclosedAt), new Date(tradedAt))
}
