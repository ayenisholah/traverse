import type { NextConfig } from "next";

// One app, two builds. The static export is the public demo on GitHub Pages, which serves it from
// a subpath, so that build sets BASE_PATH. TRAVERSE_BUILD=server builds the app that runs on a
// server, and only that build sees files ending in `.live.ts` or `.live.tsx`: the live routes, the
// API handler and the start-up check. The export can't hold them, and a test fails if it does.
const exported: NextConfig = { output: "export", basePath: process.env.BASE_PATH ?? "" };
const served: NextConfig = {
  distDir: ".next-server",
  pageExtensions: ["live.tsx", "live.ts", "tsx", "ts"],
};

export default process.env.TRAVERSE_BUILD === "server" ? served : exported;
