/** Reads a body as text, or nothing once it passes `maxBytes`, so a large one is never held whole. */
export const readCapped = async (
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | undefined> => {
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
};
