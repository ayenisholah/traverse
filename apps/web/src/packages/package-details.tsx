import Link from "next/link";
import { AdvisoryList } from "./advisory-list.tsx";
import { packagePath } from "./package-path.ts";
import type { PackageDetails as Details } from "./types.ts";

// The repositories subgraph only ever serves a GitHub address of this shape (FR-SG-3).
const GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

const number = new Intl.NumberFormat("en");

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-fg-muted">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-surface p-4">
      <h2 className="mb-2 text-h6">{title}</h2>
      {children}
    </section>
  );
}

function Repository({ repository }: { repository: Details["repository"] }) {
  if (repository === null) return <p className="text-fg-muted">No GitHub repository found.</p>;
  const { url, stars, owner, latestRelease } = repository;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Fact term="Address">
        {GITHUB.test(url) ? (
          <a className="text-brand-fg underline" href={url}>
            {url.replace("https://github.com/", "")}
          </a>
        ) : (
          url
        )}
      </Fact>
      <Fact term="Owner">{owner}</Fact>
      <Fact term="Stars">{number.format(stars)}</Fact>
      <Fact term="Latest release">{latestRelease ?? "None"}</Fact>
    </dl>
  );
}

function Advisories({ advisories }: { advisories: Details["advisories"] }) {
  if (advisories === null) {
    return (
      <p className="text-warning">Advisories couldn&apos;t be read just now, so none are shown.</p>
    );
  }
  if (advisories.length === 0) return <p>OSV knows of no advisories for this package.</p>;
  return <AdvisoryList advisories={advisories} />;
}

/** One package's facts, versions, dependencies, repository and advisories (FR-WB-8). */
export function PackageDetails({ details }: { details: Details }) {
  const { latestVersion, license, weeklyDownloads, recentVersions, versionCount, dependencies } =
    details;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact term="Latest version">{latestVersion}</Fact>
        <Fact term="Licence">{license ?? "None given"}</Fact>
        <Fact term="Downloads last week">
          {weeklyDownloads === null ? "Unknown" : number.format(weeklyDownloads)}
        </Fact>
      </dl>
      <Section title="Advisories">
        <p className="mb-2 text-caption text-fg-muted">
          Every advisory OSV holds for this package, in any version.
        </p>
        <Advisories advisories={details.advisories} />
      </Section>
      <Section title="Repository">
        <Repository repository={details.repository} />
      </Section>
      <Section title={`Dependencies (${String(dependencies.length)})`}>
        {dependencies.length === 0 ? (
          <p>This version has no dependencies.</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {dependencies.map(({ name, range }) => (
              <li key={name}>
                <Link className="text-brand-fg underline" href={packagePath(name)}>
                  {name}
                </Link>{" "}
                <span className="text-fg-muted">{range}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Versions">
        {versionCount === null ? (
          <p className="text-warning">The version list couldn&apos;t be read just now.</p>
        ) : (
          <>
            <p className="mb-2 text-caption text-fg-muted">
              The newest {recentVersions.length} of {versionCount}.
            </p>
            <ul className="flex flex-wrap gap-2">
              {recentVersions.map((version) => (
                <li key={version} className="rounded-sm bg-surface-sunken px-2 py-1 text-caption">
                  {version}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
