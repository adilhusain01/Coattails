import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  images: { remotePatterns: [{ hostname: "unitedstates.github.io" }] },
}

export default nextConfig
