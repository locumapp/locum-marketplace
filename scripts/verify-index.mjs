// Checks index.json.sig against index.json with the public key of this repository, or --public-key.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { PUBLIC_KEY, verifyIndex } from "./lib/signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: { signature: { type: "string" }, "public-key": { type: "string" } } });
const index = positionals[0] === undefined ? join(root, "index.json") : resolve(positionals[0]);
const signature = values.signature === undefined ? `${index}.sig` : resolve(values.signature);

const ok = verifyIndex(await readFile(index), await readFile(signature, "utf8"), values["public-key"] ?? PUBLIC_KEY);
if (!ok) {
  process.stderr.write(`the signature in ${signature} does not match ${index}\n`);
  process.exit(1);
}
process.stdout.write(`signature of ${index} is valid\n`);
