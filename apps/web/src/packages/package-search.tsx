"use client";

import { isPackageName } from "@traverse/formats";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { packagePath } from "./package-path.ts";

const field = "w-full rounded-sm border border-fg-subtle bg-surface px-3 py-2 text-caption";

/** Opens a package's page by name. */
export function PackageSearch({ open }: { open?: (path: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!isPackageName(trimmed)) {
      setInvalid(true);
      return;
    }
    (open ?? ((path: string) => router.push(path)))(packagePath(trimmed));
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="grow">
        <label htmlFor="package-name" className="mb-1 block text-subtitle">
          Package name
        </label>
        <input
          id="package-name"
          className={field}
          value={name}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby={invalid ? "package-name-error" : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setInvalid(false);
          }}
        />
        {invalid ? (
          <p id="package-name-error" className="text-caption text-danger">
            That isn&apos;t an npm package name, such as express or @types/node.
          </p>
        ) : null}
      </div>
      <button type="submit" className="rounded-sm bg-brand px-4 py-2 text-on-brand">
        Open
      </button>
    </form>
  );
}
