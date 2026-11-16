import { defineConfig, devices } from "@playwright/test";

// The static export is the public demo, and TRAVERSE_BUILD=server tests the app that runs on a
// server. The server build runs the export's suites too, plus test/live.
const served = process.env.TRAVERSE_BUILD === "server";
const port = served ? 4174 : 4173;
const local = `http://127.0.0.1:${port}`;

// BASE_PATH tests a build served from a subpath, as GitHub Pages does. DEMO_URL tests the public
// site. Both run test/demo, because the other suites use paths from the root.
const basePath = process.env.BASE_PATH ?? "";
const demoUrl = process.env.DEMO_URL;
const isDemo = basePath !== "" || demoUrl !== undefined;

const suites = (): { testDir: string; testMatch?: string[] } => {
  if (isDemo) return { testDir: "test/demo" };
  if (served) return { testDir: "test", testMatch: ["e2e/**/*.spec.ts", "live/**/*.spec.ts"] };
  return { testDir: "test/e2e" };
};

export default defineConfig({
  ...suites(),
  forbidOnly: true,
  reporter: "list",
  use: { baseURL: demoUrl ?? `${local}${basePath}/` },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  ...(demoUrl === undefined && {
    webServer: {
      // The export is served as files, because that's what the public demo ships. The server
      // build runs as itself, with a stub router behind it.
      command: served
        ? `node test/support/serve-live.ts ${port}`
        : `npx vite preview --outDir out --base ${basePath}/ --host 127.0.0.1 --port ${port} --strictPort`,
      url: `${local}${basePath}/`,
      reuseExistingServer: false,
    },
  }),
});
