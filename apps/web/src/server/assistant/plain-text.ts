import { scrub } from "./prompt.ts";

// Shown as plain text, but a link, an address or markup would still read as something it isn't.
const LOOKS_LIKE_MARKUP = [
  /[a-z][a-z0-9+.-]*:\/\//i,
  /\b(?:mailto|javascript|data|vbscript|file):/i,
  /\bwww\./i,
  /<\s*\/?\s*[a-z!]/i,
  /\]\(|`|\*\*|__|^\s*#/m,
];

// Look-alike and invisible characters could hide a link from the patterns above.
const INVISIBLE = new RegExp("[\\u200B-\\u200D\\u2060\\uFEFF\\u00AD]", "g");

/** Text as it reads, with look-alikes folded and invisible characters gone. */
export const asRead = (text: string): string => text.normalize("NFKC").replace(INVISIBLE, "");

/**
 * Whether model text may be shown as it is (GR-12): no link, address, markup, markdown or code,
 * and nothing a token or email scrub would remove.
 */
export const isPlainText = (text: string): boolean => {
  const read = asRead(text);
  return LOOKS_LIKE_MARKUP.every((pattern) => !pattern.test(read)) && scrub(read) === read;
};
