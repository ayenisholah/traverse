/** A source's own address, or a local stand-in for tests. A wrong one could answer anything. */
export const isSafeEndpoint = (url: string, official: string): boolean => {
  const { protocol, hostname } = new URL(url);
  const isLocal = protocol === "http:" && (hostname === "127.0.0.1" || !hostname.includes("."));
  return url === official || isLocal;
};
