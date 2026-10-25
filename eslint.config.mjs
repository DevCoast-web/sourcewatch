import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "data/**",
      ".test-data/**",
      ".browsers/**",
      "examples/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        document: "readonly",
        location: "readonly",
        getComputedStyle: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        innerWidth: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
