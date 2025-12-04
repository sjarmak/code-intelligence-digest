import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.json",
  },
  // Disable ISR/SSG for all pages to force runtime rendering
  onDemandEntries: {
    maxInactiveAge: 1000,
    pagesBufferLength: 0,
  },
};

export default nextConfig;
