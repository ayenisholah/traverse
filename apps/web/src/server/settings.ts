import { z } from "zod";

const isLocal = (hostname: string): boolean => hostname === "127.0.0.1" || !hostname.includes(".");

// An origin only: no path, query or credentials, so nothing else can ride along in the setting.
// Plain HTTP is for this machine or a service name on a private network, never a public host.
const isRouterOrigin = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const isOrigin = url.origin === value && url.username === "" && url.password === "";
  return (
    isOrigin && (url.protocol === "https:" || (url.protocol === "http:" && isLocal(url.hostname)))
  );
};

const schema = z.object({ PUBLIC_ROUTER_URL: z.string().refine(isRouterOrigin) });

export interface Settings {
  publicRouterUrl: string;
}

/**
 * The server's settings, read once. None of them may be a variable Next.js copies into the
 * browser's code (GR-9), and a test refuses that prefix anywhere in the app. The error never
 * repeats a value.
 */
export const readSettings = (env: Record<string, string | undefined>): Settings => {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      "Set PUBLIC_ROUTER_URL to the public router's origin, such as http://127.0.0.1:3002",
    );
  }
  return { publicRouterUrl: parsed.data.PUBLIC_ROUTER_URL };
};
