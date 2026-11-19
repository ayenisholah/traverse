import { defineConfig } from "vitest/config";

// Kept apart because these tests need Docker: the pinned router image, and Postgres.
export default defineConfig({
  test: {
    include: ["router/test/e2e/**/*.test.ts", "subgraphs/*/test/postgres/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    allowOnly: false,
    fileParallelism: false,
  },
});
