import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.json",
  },
  staticPageGenerationTimeout: 120,
};

export default nextConfig;
