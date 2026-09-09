import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is only used for self-hosted containers (bun start);
  // Vercel uses its own build pipeline and ignores this.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
