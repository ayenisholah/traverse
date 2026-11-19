import Link from "next/link";
import { AccountControl } from "./account/account-control.tsx";

const link = "text-brand-fg underline";

/** `live` adds the routes only the server build has. The static demo can't link to them. */
export function SiteNav({ live }: { live: boolean }) {
  return (
    <nav aria-label="Main" className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-6 pt-4">
      <Link className={link} href="/">
        Graph map
      </Link>
      <Link className={link} href="/impact">
        Impact check
      </Link>
      {live ? (
        <>
          <Link className={link} href="/operations">
            Operations
          </Link>
          <Link className={link} href="/packages">
            Packages
          </Link>
          <AccountControl />
        </>
      ) : null}
    </nav>
  );
}
