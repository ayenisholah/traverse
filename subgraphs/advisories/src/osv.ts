import {
  cachePolicy,
  invalidInput,
  isPackageName,
  isVersion,
  upstreamError,
  type CachePolicy,
  type Upstream,
} from "@traverse/subgraph-kit";
import { compare, gt, lt, lte, valid } from "semver";
import { z } from "zod";

export interface AdvisoryData {
  id: string;
  summary: string;
  severity: string | null;
  fixedIn: string | null;
}

export interface OsvClient {
  advisories: (name: unknown, version: unknown) => Promise<AdvisoryData[] | null>;
  advisory: (id: unknown) => Promise<AdvisoryData | null>;
}

interface OsvOptions {
  upstream: Upstream;
  baseUrl: string;
}

export const OSV_URL = "https://api.osv.dev";

const MINUTE = 60;

// No stale answers at all. During an outage, a stale list could hide an advisory published since,
// so an error is more honest. An empty list means "safe", so it's kept for less time.
const advisoryPolicy = cachePolicy({
  fresh: 60 * MINUTE,
  stale: 60 * MINUTE,
  missing: 10 * MINUTE,
});

interface Page {
  advisories: AdvisoryData[];
  nextPage?: string | undefined;
}

const pagePolicy = (page: Page | null): CachePolicy => {
  const isEmpty = page?.advisories.length === 0 && page.nextPage === undefined;
  const seconds = (isEmpty ? 5 : 15) * MINUTE;
  return { freshSeconds: seconds, staleSeconds: seconds };
};

export const SOURCE = "OSV";
const ADVISORY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/i;
const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
const MAX_SUMMARY_LENGTH = 300;
const MAX_RAW_SUMMARY_LENGTH = 1000;
const MAX_PAGES = 10;

// A release line's suffix, such as `beta.3` or `canary.13`. Anything longer isn't a version.
const FIX_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.]{1,30})?$/i;

// `@` is fine in `lodash@4.17.20` and `@babel/core`. Anywhere else, it may be an address.
const LOOSE_AT = /@(?!\d+(?:\.\d+)*(?:-[\w.]+)?(?![.\w])|[a-z0-9-]+\/)/i;
const SPELLED_OUT_AT = /%40|%2540|&#|&commat|\(at\)|\[at\]|mailto:/i;

const hasAddress = (text: string): boolean => LOOSE_AT.test(text) || SPELLED_OUT_AT.test(text);

/**
 * Prose can't be held to a format, so it's cleaned, and anything address-shaped costs the sentence.
 * The ID still identifies the advisory. Format characters go before the check, or one could split
 * an address in two. Length comes first, because no timeout can interrupt a regex (GR-13, GR-16).
 * Spelling an address out in words can't be caught, which `docs/THREAT_MODEL.md` accepts.
 */
const cleanSummary = (summary: string | undefined, id: string): string => {
  if (summary === undefined || summary.length > MAX_RAW_SUMMARY_LENGTH) return id;
  const text = summary
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Mn}\p{Me}]+/gu, "")
    .replace(/[\p{C}\p{Z}]+/gu, " ")
    .trim();
  if (text === "" || hasAddress(text)) return id;
  return Array.from(text).slice(0, MAX_SUMMARY_LENGTH).join("");
};

const isPast = (timestamp: string): boolean => Date.parse(timestamp) <= Date.now();

const eventSchema = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
});

type OsvEvent = z.infer<typeof eventSchema>;

const recordSchema = z.object({
  id: z.string().regex(ADVISORY_ID),
  summary: z.string().optional(),
  // A bad value here fails the response, or a typo upstream could hide an advisory.
  withdrawn: z.string().refine(isPast).optional(),
  database_specific: z
    .object({ severity: z.enum(SEVERITIES).optional().catch(undefined) })
    .optional()
    .catch(undefined),
  affected: z
    .array(
      z.object({
        package: z.object({ name: z.string(), ecosystem: z.string().optional() }).optional(),
        ranges: z
          .array(z.object({ type: z.string().optional(), events: z.array(eventSchema) }))
          .default([]),
      }),
    )
    .default([]),
});

type OsvRecord = z.infer<typeof recordSchema>;

interface Scope {
  name: string;
  version: string | undefined;
}

interface Interval {
  from: string;
  to: string | null;
  inclusive: boolean;
}

const eventVersion = ({ introduced, fixed, last_affected: last }: OsvEvent): string | null =>
  valid(introduced ?? fixed ?? last) ?? (introduced === undefined ? null : "0.0.0");

const inOrder = (left: OsvEvent, right: OsvEvent): number => {
  const [a, b] = [eventVersion(left), eventVersion(right)];
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return compare(a, b);
};

// An end that can't be read leaves the range open, which can only withhold a fix, not invent one.
const toIntervals = (events: OsvEvent[]): Interval[] => {
  const intervals: Interval[] = [];
  let from: string | null = null;
  for (const event of events.toSorted(inOrder)) {
    if (event.introduced !== undefined) from ??= eventVersion(event);
    else if (from !== null) {
      const inclusive = event.last_affected !== undefined;
      intervals.push({ from, to: eventVersion(event), inclusive });
      from = null;
    }
  }
  return from === null ? intervals : [...intervals, { from, to: null, inclusive: false }];
};

const isInside = (version: string, { from, to, inclusive }: Interval): boolean => {
  if (lt(version, from)) return false;
  if (to === null) return true;
  return inclusive ? lte(version, to) : lt(version, to);
};

/**
 * Most advisories list several fixes, one per release line, and name other packages as well. A fix
 * only counts if it comes after the version asked about, for this npm package, and no affected
 * range covers it. With no version, the question is about the newest affected line.
 */
const findFix = ({ affected }: OsvRecord, { name, version }: Scope): string | null => {
  const ranges = affected
    .filter((entry) => entry.package?.name === name && entry.package.ecosystem === "npm")
    .flatMap(({ ranges: entryRanges }) => entryRanges)
    .filter(({ type }) => type !== "GIT");
  const intervals = ranges.flatMap(({ events }) => toIntervals(events));
  const start =
    version ??
    intervals
      .map(({ from }) => from)
      .sort(compare)
      .at(-1);
  if (start === undefined) return null;
  const fixes = ranges
    .flatMap(({ events }) => events)
    .flatMap(({ fixed }) => (fixed !== undefined && FIX_VERSION.test(fixed) ? [fixed] : []))
    .sort(compare);
  return (
    fixes.find(
      (fixed) => gt(fixed, start) && !intervals.some((interval) => isInside(fixed, interval)),
    ) ?? null
  );
};

const toAdvisory = (record: OsvRecord, scope: Scope | undefined): AdvisoryData => ({
  id: record.id,
  summary: cleanSummary(record.summary, record.id),
  severity: record.database_specific?.severity ?? null,
  fixedIn: scope ? findFix(record, scope) : null,
});

/**
 * Strict, because OSV answers `{}` for a safe package. An error body or a renamed field must fail
 * here, or it would read as no advisories. A new OSV field fails too, which the scheduled check
 * reports, and that's the safer way round for a security tool.
 */
export const querySchema = (scope: Scope) =>
  z
    .strictObject({
      vulns: z.array(recordSchema).optional(),
      next_page_token: z.string().optional(),
    })
    .transform(({ vulns = [], next_page_token: nextPage }) => ({
      advisories: vulns
        .filter(({ withdrawn }) => withdrawn === undefined)
        .map((record) => toAdvisory(record, scope)),
      nextPage,
    }));

// With no package to compare, this can't say which version fixes it.
export const advisorySchema = recordSchema.transform((record) =>
  record.withdrawn === undefined ? toAdvisory(record, undefined) : null,
);

const requireVersion = (version: unknown): string | undefined => {
  if (version === null || version === undefined) return undefined;
  if (!isVersion(version)) throw invalidInput("That isn't a valid version.");
  return version;
};

// What the cache may hold, checked again on the way back out, with the same rules as on the way in.
const advisoryStored = z
  .object({
    id: z.string().regex(ADVISORY_ID),
    summary: z.string(),
    severity: z.enum(SEVERITIES).nullable(),
    fixedIn: z.string().regex(FIX_VERSION).nullable(),
  })
  .refine(({ id, summary }) => cleanSummary(summary, id) === summary);

const pageStored = z.object({
  advisories: z.array(advisoryStored),
  nextPage: z.string().optional(),
});

export const createOsvClient = ({ upstream, baseUrl }: OsvOptions): OsvClient => {
  const query = async (name: string, version: string | undefined, pageToken: string | undefined) =>
    (await upstream.call({
      key: `query:${name}@${version ?? "*"}#${pageToken ?? ""}`,
      policy: pagePolicy,
      stored: pageStored,
      request: {
        url: `${baseUrl}/v1/query`,
        schema: querySchema({ name, version }),
        method: "POST",
        notFoundIsFailure: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          package: { name, ecosystem: "npm" },
          ...(version !== undefined && { version }),
          ...(pageToken !== undefined && { page_token: pageToken }),
        }),
      },
    })) as Page;

  const allPages = async (name: string, version: string | undefined): Promise<AdvisoryData[]> => {
    const found: AdvisoryData[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { advisories, nextPage } = await query(name, version, pageToken);
      found.push(...advisories);
      if (nextPage === undefined) return found;
      pageToken = nextPage;
    }
    // A partial list would read as a complete one, which is worse than none.
    throw upstreamError(SOURCE);
  };

  return {
    advisories: async (name, version) =>
      isPackageName(name) ? allPages(name, requireVersion(version)) : null,
    advisory: (id) =>
      typeof id === "string" && ADVISORY_ID.test(id)
        ? upstream.call({
            key: `vuln:${id}`,
            policy: advisoryPolicy,
            stored: advisoryStored,
            request: { url: `${baseUrl}/v1/vulns/${id}`, schema: advisorySchema },
          })
        : Promise.resolve(null),
  };
};
