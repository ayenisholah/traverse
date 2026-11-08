import { defineConfig } from "vitest/config";

// Kept apart because these tests run the pinned router image, which needs Docker.
export default defineConfig({
  test: {
    include: ["router/test/e2e/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    allowOnly: false,
    fileParallelism: false,
  },
});
