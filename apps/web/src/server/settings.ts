import { z } from "zod";

// An origin only: no path, query or credentials, so nothing else can ride along in the setting.
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;

const schema = z.object({ PUBLIC_ROUTER_URL: z.string().regex(ORIGIN) });

export interface Settings {
  publicRouterUrl: string;
}

/**
 * The server's settings, read once. None of them may start with NEXT_PUBLIC_, because Next.js
 * copies those into the browser's code (GR-9). The error never repeats a value.
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
