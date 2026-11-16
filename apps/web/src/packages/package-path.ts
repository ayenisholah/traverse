import { isPackageName } from "@traverse/formats";

/**
 * The page for a package. A scope's `/` stays a path separator, and each part is encoded. A name
 * npm couldn't have, such as `..`, gets the packages page itself, so no link can lead elsewhere.
 */
export const packagePath = (name: string): string =>
  isPackageName(name)
    ? `/packages/${name.split("/").map(encodeURIComponent).join("/")}`
    : "/packages";

/** The package name from the page's path segments, or nothing if they can't be one. */
export const nameFromSegments = (segments: string[]): string | undefined => {
  try {
    return segments.map(decodeURIComponent).join("/");
  } catch {
    return undefined;
  }
};
