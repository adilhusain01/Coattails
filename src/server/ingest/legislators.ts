const URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"

type Legislator = {
  id: { bioguide: string }
  name: { first: string; last: string; official_full?: string; nickname?: string }
  terms: { type: "rep" | "sen"; state: string; district?: number; party: string }[]
}

export type Member = { bioguide: string; name: string; party: "D" | "R" | "I"; seat: string; photoUrl: string }

let cache: Map<string, Member> | null = null

/** Current House members keyed by "CA11"-style seat, the format the Clerk's index uses. */
export async function houseMembers(): Promise<Map<string, Member>> {
  if (cache) return cache
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`legislators ${res.status}`)
  const rows = (await res.json()) as Legislator[]
  cache = new Map()
  for (const l of rows) {
    const term = l.terms.at(-1)!
    if (term.type !== "rep") continue
    const seat = `${term.state}${String(term.district ?? 0).padStart(2, "0")}`
    cache.set(seat, {
      bioguide: l.id.bioguide,
      name: l.name.official_full ?? `${l.name.first} ${l.name.last}`,
      party: term.party.startsWith("Dem") ? "D" : term.party.startsWith("Rep") ? "R" : "I",
      seat,
      photoUrl: `https://unitedstates.github.io/images/congress/225x275/${l.id.bioguide}.jpg`,
    })
  }
  return cache
}
