import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reduce noise from generated artifacts and archived scripts/docs
    "history/**",
    "scripts/**",
    "__tests__/**",
    "__mocks__/**",
  ]),
  {
    // Apply targeted rule overrides for the app/src code we care about
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    rules: {
      // These rules from eslint-config-next react plugin currently fire on
      // legitimate state sync effects and date initialization logic.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      // These rules are overly noisy in our mixed client/server code. Track
      // remaining usages via warnings while we gradually type things.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
