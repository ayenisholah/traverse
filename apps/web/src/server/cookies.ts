import { EncryptJWT, jwtDecrypt } from "jose";
import type { z } from "zod";

export interface SealedCookies {
  /** A `Set-Cookie` value holding `value`, encrypted, readable for `seconds` and no longer. */
  seal: (name: string, value: Record<string, unknown>, seconds: number) => Promise<string>;
  /** The cookie's value, or nothing if it's missing, tampered with, expired or the wrong shape. */
  open: <T>(request: Request, name: string, schema: z.ZodType<T>) => Promise<T | undefined>;
  /** A `Set-Cookie` value that removes the cookie. */
  clear: (name: string) => string;
}

interface Options {
  key: Uint8Array;
  /** On HTTPS. Settings allow plain HTTP for this machine only. */
  secure: boolean;
}

const readCookie = (request: Request, name: string): string | undefined =>
  (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/**
 * Cookies the browser holds and can't read (GR-9): each value is encrypted with the server's key,
 * so the browser sees only ciphertext, and a changed one doesn't open. `HttpOnly` keeps them from
 * page scripts, and `SameSite=Lax` from another site's requests, except a top-level navigation,
 * which is how the user pool sends the browser back. On HTTPS the `__Host-` prefix also pins them
 * to this host and path.
 */
export const createSealedCookies = ({ key, secure }: Options): SealedCookies => {
  const fullName = (name: string) => (secure ? `__Host-${name}` : name);
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return {
    seal: async (name, value, seconds) => {
      // The name goes inside, so one cookie's value can't be replayed under another's name.
      const sealed = await new EncryptJWT({ ...value, cookie: name })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt()
        .setExpirationTime(`${String(seconds)}s`)
        .encrypt(key);
      return `${fullName(name)}=${sealed}; Max-Age=${String(seconds)}; ${attributes}`;
    },
    open: async (request, name, schema) => {
      const sealed = readCookie(request, fullName(name));
      if (sealed === undefined) return undefined;
      try {
        const { payload } = await jwtDecrypt(sealed, key, {
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        });
        if (payload.cookie !== name) return undefined;
        const parsed = schema.safeParse(payload);
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    clear: (name) => `${fullName(name)}=; Max-Age=0; ${attributes}`,
  };
};
