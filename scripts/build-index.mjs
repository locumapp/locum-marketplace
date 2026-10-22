// Writes index.json for the catalog. The commit comes from --commit, GITHUB_SHA or HEAD, and its time from git.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildIndex } from "./lib/build-index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { commit: { type: "string" }, out: { type: "string" } } });
const commit = values.commit ?? process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const out = values.out === undefined ? join(root, "index.json") : resolve(values.out);

try {
  const committedAt = Number(execFileSync("git", ["show", "-s", "--format=%ct", `${commit}^{commit}`], { cwd: root, encoding: "utf8" }).trim());
  const bytes = await buildIndex(root, { commit, committedAt });
  await writeFile(out, bytes);
  process.stdout.write(`index.json for ${commit} written to ${out}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
