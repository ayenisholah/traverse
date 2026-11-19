import { defineConfig } from "vitest/config";

// Kept apart because these tests need Docker: the pinned router image, Postgres and Redis.
export default defineConfig({
  test: {
    include: [
      "router/test/e2e/**/*.test.ts",
      "subgraphs/*/test/postgres/**/*.test.ts",
      "apps/web/test/redis/**/*.test.ts",
    ],
    environment: "node",
    restoreMocks: true,
    allowOnly: false,
    fileParallelism: false,
  },
});
