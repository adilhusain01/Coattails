import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ImageResponse } from "next/og"

export const dynamic = "force-static"

/** 512x512 token image for the Coattails agent token (COAT), used by Clawpump and wallets. */
export function GET() {
  const svg = readFileSync(join(process.cwd(), "public/icon.svg"))
  const icon = `data:image/svg+xml;base64,${svg.toString("base64")}`
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#15241d",
          color: "#f6faf4",
          gap: 24,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} width={280} height={280} alt="" />
        <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>COAT</div>
      </div>
    ),
    { width: 512, height: 512 },
  )
}
