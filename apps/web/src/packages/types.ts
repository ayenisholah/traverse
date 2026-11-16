export interface Advisory {
  id: string;
  summary: string;
  severity: string | null;
}

/** What the package page shows. Versions are cut to the newest few, newest first. */
export interface PackageDetails {
  name: string;
  latestVersion: string;
  license: string | null;
  weeklyDownloads: number | null;
  recentVersions: string[];
  versionCount: number | null;
  dependencies: { name: string; range: string }[];
  repository: { url: string; stars: number; owner: string; latestRelease: string | null } | null;
  advisories: Advisory[] | null;
}

export type PackageAnswer =
  | { kind: "found"; package: PackageDetails; incomplete: boolean }
  | { kind: "not-found" }
  | { kind: "unavailable" };

/** One dependency from a package.json, as the check found it. */
export type DependencyResult = { name: string; range: string } & (
  | {
      status: "checked";
      /** The lowest version the range allows, which is what the advisories are for. */
      version: string;
      latestVersion: string;
      license: string | null;
      /** Null when the advisories couldn't be read, which is never the same as none. */
      advisories: (Advisory & { fixedIn: string | null })[] | null;
    }
  | { status: "not-found"; version: string }
  | { status: "unavailable"; version: string }
  | { status: "skipped"; reason: string }
);

export type ManifestAnswer =
  | { kind: "checked"; dependencies: DependencyResult[]; leftOut: number }
  | { kind: "invalid"; message: string };
