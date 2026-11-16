import type { Advisory } from "./types.ts";

const OSV = "https://osv.dev/vulnerability/";
// OSV's IDs: a prefix of capitals, then letters, digits and dashes. Only these become links.
const ADVISORY_ID = /^[A-Z]+-[A-Za-z0-9-]+$/;

/** Advisories as text, each linking to OSV's own page for it, never to anything else. */
export function AdvisoryList({
  advisories,
  fixes,
}: {
  advisories: (Advisory & { fixedIn?: string | null })[];
  fixes?: boolean;
}) {
  return (
    <ul className="space-y-1">
      {advisories.map(({ id, summary, severity, fixedIn }) => (
        <li key={id}>
          {ADVISORY_ID.test(id) ? (
            <a className="text-brand-fg underline" href={`${OSV}${id}`}>
              {id}
            </a>
          ) : (
            <span>{id}</span>
          )}
          {severity ? <span className="text-fg-muted"> · {severity.toLowerCase()}</span> : null}
          <span>: {summary}</span>
          {fixes ? (
            <span className="text-fg-muted">
              {" "}
              · {fixedIn ? `fixed in ${fixedIn}` : "no fix for this version yet"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
