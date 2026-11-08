import { checkOsv } from "../subgraphs/advisories/src/live-check.ts";
import { checkNpm } from "../subgraphs/packages/src/live-check.ts";
import { checkGithub } from "../subgraphs/repositories/src/live-check.ts";

/**
 * Runs each subgraph's real client against its live source. Tests replay recordings, so this is
 * what notices when a source changes its answers (FR-SG-10).
 */
const token = process.env.GITHUB_TOKEN;
const problems = (
  await Promise.all([
    checkNpm(fetch),
    token ? checkGithub(fetch, token) : Promise.resolve(["GitHub: GITHUB_TOKEN is required"]),
    checkOsv(fetch),
  ])
).flat();

for (const problem of problems) process.stderr.write(`${problem}\n`);
process.stdout.write(problems.length === 0 ? "All sources answered as expected.\n" : "");
process.exitCode = problems.length === 0 ? 0 : 1;
