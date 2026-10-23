// Checks that the files of the official connection ids are owned by the maintainers, the owners of CODEOWNERS itself.
// What GitHub enforces with these owners (review required on the PR) depends on branch protection, not on this check.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OFFICIAL_CONNECTIONS } from "./rules.mjs";

export const CODEOWNERS = ".github/CODEOWNERS";
const OFFICIAL_LIST = "scripts/lib/official-connections.json";

/**
 * A CODEOWNERS pattern as a regular expression over a repository path, as GitHub reads it: a leading `**\/` also
 * matches at the root, a pattern ending in a wildcard (`dir/*`) does not go into subfolders, and any other pattern
 * also covers what is under it.
 */
function patternToRegExp(pattern) {
  const directory = pattern.endsWith("/");
  const body = pattern.replace(/^\//, "").replace(/\/$/, "");
  const anchored = pattern.startsWith("/") || body.includes("/");
  const lastSegment = body.split("/").pop();
  const source = body
    .replace(/^\*\*\//, "\0")
    .split(/(\0|\*\*|\*|\?)/)
    .map((part) => (part === "\0" ? "(.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  const below = directory ? "/.*" : /[*?]/.test(lastSegment) ? "" : "(/.*)?";
  return new RegExp(`^${anchored ? "" : "(.*/)?"}${source}${below}$`);
}

export function parseCodeowners(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s#.*$/, "").trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { match: patternToRegExp(pattern), owners: owners.map((o) => o.toLowerCase()).sort() };
    });
}

/** The owners of a path, in lowercase: those of the last line that matches it. */
export function ownersOf(rules, path) {
  return rules.findLast((rule) => rule.match.test(path))?.owners ?? [];
}

/** Errors as `{ file, field, message }` when an official id or the list of them can change without the maintainers. */
export async function checkCodeowners(root) {
  const file = join(root, CODEOWNERS);
  const error = (message) => ({ file, field: "", message });
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return [error(`${CODEOWNERS} is missing: it reserves the official connection ids for the maintainers`)];
    throw e;
  }
  const rules = parseCodeowners(text);
  const maintainers = ownersOf(rules, CODEOWNERS);
  const errors = [];
  for (const path of [OFFICIAL_LIST, ...[...OFFICIAL_CONNECTIONS.keys()].map((id) => `connections/${id}.json`)]) {
    const owners = ownersOf(rules, path);
    if (owners.length === 0) {
      errors.push(error(`${path} has no owner in ${CODEOWNERS}; official ids change only with the maintainers' review`));
    } else if (maintainers.length > 0 && owners.join(" ") !== maintainers.join(" ")) {
      errors.push(error(`${path} is owned by ${owners.join(" ")}, not by the maintainers who own ${CODEOWNERS} (${maintainers.join(" ")})`));
    }
  }
  if (maintainers.length === 0) errors.unshift(error(`${CODEOWNERS} has no owner for itself, so nobody holds the official ids`));
  return errors;
}
