import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'node',
    // Keep tests fast + deterministic in CI/agents
    passWithNoTests: true,
    server: {
      deps: {
        // Next.js + next-auth pull in packages that need to be pre-bundled for Vitest's SSR transform pipeline
        inline: ['next', 'next-auth'],
      },
    },
  },
  resolve: {
    alias: {
      // Must match tsconfig.json paths: "@/*": ["./*"]
      '@': path.resolve(__dirname, '.'),
    },
  },
});
