import { createActionHeaders, type ActionsJson } from "@solana/actions"

const headers = createActionHeaders()

/** Maps shareable profile links to their Blink, so /app/p/nancy-pelosi unfurls as "Mirror Pelosi". */
export function GET() {
  const body: ActionsJson = {
    rules: [
      { pathPattern: "/app/p/*", apiPath: "/api/actions/mirror/*" },
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  }
  return Response.json(body, { headers })
}

export const OPTIONS = GET
