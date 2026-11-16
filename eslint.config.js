import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

const SOURCE_FILES = [
  "apps/*/src/**/*.{ts,tsx}",
  "packages/*/src/**/*.ts",
  "subgraphs/*/src/**/*.ts",
  "infra/src/**/*.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "**/cdk.out/**",
      "reports/**",
      "**/.next/**",
      "**/.next-server/**",
      "**/out/**",
      "**/next-env.d.ts",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Fakes in tests are loosely typed by design.
    files: ["**/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // eslint-config-next bundles plugins whose peer ranges stop at ESLint 9, so these are added directly.
    files: ["apps/*/{src,test}/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: { ...nextPlugin.configs.recommended.rules, ...reactHooks.configs.recommended.rules },
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    // Size limits keep functions modular. A describe block is not a unit of design, so tests are exempt.
    files: SOURCE_FILES,
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "no-console": "error",
    },
  },
);
