import { FlatCompat } from "@eslint/eslintrc";

// Flat config for the ESLint CLI (`next lint` is deprecated and interactive;
// `eslint .` is what CI runs). FlatCompat adapts Next's shareable config.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "eval-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
];

export default config;
