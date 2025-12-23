import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.json",
  },
  staticPageGenerationTimeout: 120,
  // output: 'standalone', // Disabled until Pages Router _error conflict is resolved
};

export default nextConfig;
