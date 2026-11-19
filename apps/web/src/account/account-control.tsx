"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createApiClient } from "../api-client.ts";

export interface Viewer {
  canSignIn: boolean;
  signedIn: boolean;
}

export type LoadViewer = () => Promise<Viewer>;

const askServer: LoadViewer = () => createApiClient().viewer.query();

const link = "text-brand-fg underline";

/**
 * Sign in or sign out, in the server build. It shows nothing until the server answers, and nothing
 * at all if the server has no user pool or can't say, because the app works without an account.
 * It never shows who is signed in: the server doesn't tell it (GR-16).
 */
export function AccountControl({ loadViewer = askServer }: { loadViewer?: LoadViewer }) {
  const [viewer, setViewer] = useState<Viewer | undefined>();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    let current = true;
    loadViewer().then(
      (answer) => current && setViewer(answer),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [loadViewer]);

  if (viewer?.canSignIn !== true) return null;
  if (viewer.signedIn) {
    // A form, so signing out is a POST from this page, which the server checks (ADR 0020).
    return (
      <form method="post" action="/sign-out" className="ms-auto">
        <button type="submit" className={link}>
          Sign out
        </button>
      </form>
    );
  }
  return (
    // A route handler, not a page, so a plain link rather than a client-side one.
    <a className={`${link} ms-auto`} href={`/sign-in?returnTo=${encodeURIComponent(pathname)}`}>
      Sign in
    </a>
  );
}
