import { isPackageName } from "@traverse/formats";
import Link from "next/link";
import { nameFromSegments } from "../../../packages/package-path.ts";
import { PackageExplorer } from "../../../packages/package-explorer.tsx";

interface Props {
  params: Promise<{ name: string[] }>;
}

export const generateMetadata = async ({ params }: Props) => {
  const name = nameFromSegments((await params).name);
  return { title: `${name !== undefined && isPackageName(name) ? name : "Package"} · Traverse` };
};

export default async function PackagePage({ params }: Props) {
  const name = nameFromSegments((await params).name);
  const valid = name !== undefined && isPackageName(name);
  return (
    <main className="mx-auto max-w-7xl p-6">
      <p className="mb-2">
        <Link className="text-brand-fg underline" href="/packages">
          All packages
        </Link>
      </p>
      <h1 className="mb-4 text-h4">{valid ? name : "Not a package name"}</h1>
      {valid ? (
        <PackageExplorer name={name} />
      ) : (
        <p>This address doesn&apos;t name an npm package.</p>
      )}
    </main>
  );
}
