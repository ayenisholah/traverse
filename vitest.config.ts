import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const shared = { restoreMocks: true, allowOnly: false };

export default defineConfig({
  test: {
    projects: [
      {
        // Node loads graphql's CommonJS build, and Vite would pick the ESM one. Two copies break
        // the `instanceof` checks in Yoga, which then masks deliberate errors (W-5).
        resolve: { alias: [{ find: /^graphql$/, replacement: "graphql/index.js" }] },
        test: {
          ...shared,
          name: "node",
          include: [
            "packages/*/test/**/*.test.ts",
            "subgraphs/*/test/**/*.test.ts",
            "router/test/*.test.ts",
          ],
          exclude: ["{packages,subgraphs}/*/test/integration/**"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          ...shared,
          name: "web",
          include: ["apps/*/test/*.test.{ts,tsx}"],
          setupFiles: ["apps/web/test/setup.ts"],
          environment: "jsdom",
          // axe over a full page in jsdom takes about a second, and far longer on a busy machine.
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["{apps,packages,subgraphs}/*/src/**/*.{ts,tsx}"],
      // Every exclusion needs a reason. See docs/TEST_STRATEGY.md before adding one.
      exclude: [],
      thresholds: { perFile: true, lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
