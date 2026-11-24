import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const ZOD_MSG = "Importe o Zod de '@/lib/shared/zod' (ele desliga o JIT, que viola a CSP sem unsafe-eval).";

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
  ]),
  {
    files: ["lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["lib/shared/zod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "zod", message: ZOD_MSG }],
          patterns: [{ group: ["zod/*"], message: ZOD_MSG }],
        },
      ],
    },
  },
]);

export default eslintConfig;
