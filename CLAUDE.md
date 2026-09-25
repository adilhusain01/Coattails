@AGENTS.md

## Coattails notes

- Architecture and the end-to-end loop: `docs/ARCHITECTURE.md`. API facts (House Clerk, EDGAR, xStocks, Jupiter, Pyth, Clawpump): `docs/INTEGRATIONS.md`.
- UI: shadcn components (add via `npx shadcn@latest add <name>`), Tailwind classes inline in JSX; `src/app/globals.css` holds theme tokens only. No emojis anywhere.
- Solana: `@solana/kit` 8 plugin clients and `@solana/kit-plugin-wallet`; never `@solana/web3.js` v1 or wallet-adapter. Transactions are v0. Only exception: `scripts/launch/pool.ts`, because the Meteora DLMM SDK is built on web3.js v1.
- Server-only code lives in `src/server/` and starts with `import "server-only"` where Next imports it.
- Cluster is `NEXT_PUBLIC_CLUSTER` (`devnet` now). Only the fill function differs between clusters.
- Long-running processes run under pm2 (`npx pm2 status`); don't start duplicate dev servers or workers.
