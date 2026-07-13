import { FlatCompat } from "@eslint/eslintrc";

// Flat config for the ESLint CLI (`next lint` is deprecated and interactive;
// `eslint .` is what CI runs). FlatCompat adapts Next's shareable config.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "eval-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
  {
    // M17 log hygiene: logs must never carry emails, query strings, tokens,
    // prompts, or post bodies. Bare console is banned app-wide; the one
    // sanctioned sink is lib/log.ts, which redacts before writing.
    files: ["app/**", "components/**", "hooks/**", "lib/**"],
    rules: { "no-console": "error" },
  },
];

export default config;
