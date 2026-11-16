import { isPackageName } from "@traverse/formats";
import { minVersion, validRange } from "semver";
import { z } from "zod";

/** The most dependencies one check covers, so one paste costs the sources a bounded amount. */
export const MAX_DEPENDENCIES = 100;
const MAX_RANGE_LENGTH = 256;

const section = z.record(z.string(), z.unknown()).optional();
const manifestSchema = z.object({ dependencies: section, devDependencies: section });

export type ManifestEntry = { name: string; range: string } & (
  { version: string } | { skip: string }
);

export type ParsedManifest =
  { ok: true; entries: ManifestEntry[]; leftOut: number } | { ok: false; message: string };

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

// A range that isn't semver points somewhere npm's registry doesn't answer for, such as a git
// URL, a local folder or another workspace, so the check can't say anything about it.
const toEntry = (key: string, range: unknown): ManifestEntry => {
  const text = typeof range === "string" ? range.slice(0, MAX_RANGE_LENGTH) : "";
  // Shown back to the user as text, cut to npm's own length limit.
  const shown = key.slice(0, 214);
  if (!isPackageName(key)) return { name: shown, range: text, skip: "Not an npm package name" };
  const name = key;
  if (typeof range !== "string" || range.length > MAX_RANGE_LENGTH || validRange(range) === null) {
    return { name, range: text, skip: "Not a version range from the npm registry" };
  }
  const lowest = minVersion(range);
  return lowest === null
    ? { name, range, skip: "No version satisfies this range" }
    : { name, range, version: lowest.version };
};

/**
 * Reads a pasted package.json as data, never as anything to run (GR-13): only its dependencies
 * and devDependencies, each name and range checked, and no more than the cap.
 */
export const parseManifest = (text: string): ParsedManifest => {
  const parsed = manifestSchema.safeParse(parseJson(text));
  if (!parsed.success)
    return { ok: false, message: "This isn't a package.json: it must be a JSON object." };
  const { dependencies = {}, devDependencies = {} } = parsed.data;
  const seen = new Map<string, unknown>();
  for (const [name, range] of [
    ...Object.entries(dependencies),
    ...Object.entries(devDependencies),
  ]) {
    if (!seen.has(name)) seen.set(name, range);
  }
  if (seen.size === 0) return { ok: false, message: "This package.json lists no dependencies." };
  const entries = [...seen].slice(0, MAX_DEPENDENCIES).map(([name, range]) => toEntry(name, range));
  return { ok: true, entries, leftOut: Math.max(0, seen.size - MAX_DEPENDENCIES) };
};
