import { ManifestCheck } from "../../packages/manifest-check.tsx";
import { PackageSearch } from "../../packages/package-search.tsx";

export const metadata = { title: "Packages · Traverse" };

export default function PackagesPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6">
      <div>
        <h1 className="text-h4">Packages</h1>
        <p className="text-fg-muted">
          Look a package up on live npm, GitHub and OSV data, or check a whole package.json.
        </p>
      </div>
      <div className="max-w-xl">
        <PackageSearch />
      </div>
      <ManifestCheck />
    </main>
  );
}
