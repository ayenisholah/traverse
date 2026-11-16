/** The page for a package. A scope's `@` and `/` stay readable, and nothing else can break out. */
export const packagePath = (name: string): string =>
  `/packages/${name.split("/").map(encodeURIComponent).join("/")}`;

/** The package name from the page's path segments, or nothing if they can't be one. */
export const nameFromSegments = (segments: string[]): string | undefined => {
  try {
    return segments.map(decodeURIComponent).join("/");
  } catch {
    return undefined;
  }
};
