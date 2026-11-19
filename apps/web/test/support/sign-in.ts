/**
 * Signs in as a browser would, over plain HTTP: the app's /sign-in, the local issuer's form, then
 * back to the app. Returns the session cookies, as a `cookie` header.
 */
export const signInOverHttp = async (
  webUrl: string,
  issuerUrl: string,
  username: string,
): Promise<string> => {
  const cookies = new Map<string, string>();
  const take = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";") as [string];
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const header = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const start = await fetch(`${webUrl}/sign-in`, { redirect: "manual" });
  take(start);
  const authorize = new URL(start.headers.get("location") ?? "");
  const signedIn = await fetch(`${issuerUrl}/oauth2/authorize`, {
    method: "POST",
    body: new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), username }),
    redirect: "manual",
  });
  const back = await fetch(signedIn.headers.get("location") ?? "", {
    headers: { cookie: header() },
    redirect: "manual",
  });
  take(back);
  return [...cookies]
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
};
