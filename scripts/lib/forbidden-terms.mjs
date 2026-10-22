import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the list lives: outside the repository, never committed. */
export function termsPath(env = process.env) {
  return env.LOCUM_TERMOS_PROIBIDOS ?? join(homedir(), ".config", "locum", "termos-proibidos");
}

/** One term per line; `#` starts a comment and blank lines are skipped. */
export function parseTerms(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line !== "");
}

const normalize = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Enough to find the term in the list, not enough to read it in a public log. */
const hint = (term) => `${[...term].slice(0, 2).join("")}… (${[...term].length} characters)`;

/**
 * Each line of the given files, relative to root, that holds a term as a whole word (no letter
 * or digit around it), ignoring case and accents; a space in the term matches any run of spaces.
 * Lockfiles and binary files are skipped.
 */
export async function findForbiddenTerms(root, files, terms) {
  const patterns = terms
    .map(normalize)
    .filter((term) => term !== "")
    .map((term) => ({ hint: hint(term), re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "u") }));
  const found = [];
  for (const file of files) {
    if (file.endsWith("package-lock.json")) continue;
    let bytes;
    try {
      bytes = await readFile(join(root, file));
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue;
    normalize(bytes.toString("utf8"))
      .split("\n")
      .forEach((line, i) => {
        for (const { hint, re } of patterns) if (re.test(line)) found.push({ file, line: i + 1, hint });
      });
  }
  return found;
}

export function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter((f) => f !== "");
}
