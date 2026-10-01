import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // @hebcal/core is GPL-2.0: it may only be imported by the server-side Shabbat module.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@hebcal/core",
              message: "GPL-2.0 library: import it only from src/lib/shabbat (server-side). Use @/lib/shabbat instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/shabbat/**"],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
