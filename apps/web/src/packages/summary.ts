import type { DependencyResult } from "./types.ts";

const MAX_CHECKED = 100;

const count = (results: DependencyResult[], test: (result: DependencyResult) => boolean) =>
  results.filter(test).length;

const isRead = (result: DependencyResult) =>
  result.status === "checked" && result.advisories !== null;

const isFlagged = (result: DependencyResult) =>
  result.status === "checked" && (result.advisories?.length ?? 0) > 0;

const isUnread = (result: DependencyResult) =>
  result.status === "unavailable" || (result.status === "checked" && result.advisories === null);

const readPart = (read: number, flagged: number): string => {
  if (read === 0) return "None could be checked for advisories.";
  if (flagged === 0)
    return `${String(read)} checked: none has an advisory for the version checked.`;
  const verb = flagged === 1 ? "has" : "have";
  return `${String(read)} checked: ${String(flagged)} ${verb} advisories for the version checked.`;
};

/**
 * One line on what the check found. It only says "none has an advisory" about dependencies whose
 * advisories were read, and names every one it couldn't read, so a failure never reads as clean.
 */
export const summarise = (dependencies: DependencyResult[], leftOut: number): string => {
  const listed = dependencies.length;
  const unread = count(dependencies, isUnread);
  const skipped = count(dependencies, ({ status }) => status === "skipped");
  const missing = count(dependencies, ({ status }) => status === "not-found");
  return [
    `${String(listed)} ${listed === 1 ? "dependency" : "dependencies"} listed.`,
    readPart(count(dependencies, isRead), count(dependencies, isFlagged)),
    unread > 0
      ? `${String(unread)} couldn't be read just now, so ${unread === 1 ? "it" : "they"} may have advisories.`
      : "",
    skipped > 0 ? `${String(skipped)} skipped.` : "",
    missing > 0 ? `${String(missing)} not found on npm.` : "",
    leftOut > 0
      ? `${String(leftOut)} more left out: the check covers the first ${String(MAX_CHECKED)}.`
      : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
};
