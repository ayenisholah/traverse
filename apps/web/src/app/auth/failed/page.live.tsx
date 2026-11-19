export const metadata = { title: "Sign-in didn't finish · Traverse" };

/** Where every failed sign-in ends, whatever went wrong, so no message from the user pool shows. */
export default function SignInFailedPage() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-h4">Sign-in didn&apos;t finish</h1>
      <p className="mb-4 text-fg-muted">
        Nothing was saved, and you can keep using Traverse without an account.
      </p>
      {/* A route handler, not a page, so a plain link rather than a client-side one. */}
      <a className="text-brand-fg underline" href="/sign-in">
        Try again
      </a>
    </main>
  );
}
