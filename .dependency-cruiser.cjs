/** Module boundaries from docs/ENGINEERING_STANDARDS.md, enforced in CI. */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "domain-has-no-io",
      comment: "packages/domain is pure logic: no Node built-ins, no I/O packages.",
      severity: "error",
      from: { path: "^packages/domain/src" },
      to: { dependencyTypes: ["core", "npm"], pathNot: "node_modules/zod" },
    },
    {
      name: "graph-core-runs-in-browsers",
      comment: "packages/graph-core runs in a Web Worker, so it can't use Node built-ins.",
      severity: "error",
      from: { path: "^packages/graph-core/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "packages-stay-inward",
      comment: "Packages never import subgraphs, apps or infrastructure.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^(subgraphs|apps|infra)/" },
    },
    {
      name: "subgraphs-do-not-import-subgraphs",
      severity: "error",
      from: { path: "^subgraphs/([^/]+)/" },
      to: { path: "^subgraphs/", pathNot: "^subgraphs/$1/" },
    },
    {
      name: "web-server-code-stays-on-the-server",
      comment:
        "Only the server's own modules, live route handlers and the start-up check may import apps/web/src/server, so none of it can be bundled for the browser (GR-9).",
      severity: "error",
      from: {
        path: "^apps/web/src/",
        pathNot: ["^apps/web/src/server/", "/route\\.live\\.ts$", "/instrumentation\\.live\\.ts$"],
      },
      to: { path: "^apps/web/src/server/" },
    },
    {
      name: "no-deep-package-imports",
      comment: "Import a workspace package through its entry point, not its internals.",
      severity: "error",
      from: { path: "^(apps|packages|subgraphs|infra|scripts)/([^/]+)", pathNot: "/test/" },
      to: { path: "^packages/([^/]+)/src/(?!index\\.ts$)", pathNot: "^packages/$2/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|generated)/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
