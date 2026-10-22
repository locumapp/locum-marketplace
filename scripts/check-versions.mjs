// Checks that each catalog item changed against --base went up in version, and that new ones start at 1.
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { changedItems, versionErrors } from "./lib/versions.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { base: { type: "string" } } });
if (values.base === undefined) {
  process.stderr.write("usage: check-versions --base <ref>\n");
  process.exit(2);
}

const changes = changedItems(root, values.base);
const errors = versionErrors(changes);
for (const e of errors) process.stderr.write(`${e.file}: ${e.field}: ${e.message}\n`);
if (errors.length > 0) process.exit(1);
process.stdout.write(`${changes.length} changed item(s), versions ok\n`);
