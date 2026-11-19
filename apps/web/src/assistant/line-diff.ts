export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** For every pair of positions, how many lines the rest of the two texts have in common. */
const commonLengths = (a: string[], b: string[]) => {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    }
  }
  return (i: number, j: number) => table[i * width + j] as number;
};

type Common = (i: number, j: number) => number;

/** Which line comes next: one both texts share, one only the new text has, or one it dropped. */
const nextKind = (
  { a, b, common }: { a: string[]; b: string[]; common: Common },
  i: number,
  j: number,
): DiffLine["kind"] => {
  if (i < a.length && j < b.length && a[i] === b[j]) return "same";
  if (j >= b.length) return "removed";
  return i === a.length || common(i, j + 1) >= common(i + 1, j) ? "added" : "removed";
};

/**
 * The lines that differ between two texts, as a longest common subsequence over lines. A schema is
 * at most a few thousand lines, so the table stays small.
 */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split("\n");
  const b = after.split("\n");
  const common = commonLengths(a, b);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const kind = nextKind({ a, b, common }, i, j);
    lines.push({ kind, text: (kind === "added" ? b[j] : a[i]) as string });
    if (kind !== "added") i += 1;
    if (kind !== "removed") j += 1;
  }
  return lines;
};
