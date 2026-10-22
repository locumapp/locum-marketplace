// Signs index.json with the private key in INDEX_SIGNING_KEY and writes index.json.sig.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signIndex } from "./lib/signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const index = process.argv[2] === undefined ? join(root, "index.json") : resolve(process.argv[2]);
const key = process.env.INDEX_SIGNING_KEY;

if (key === undefined || key.trim() === "") {
  process.stderr.write("INDEX_SIGNING_KEY is not set: it holds the Ed25519 private key, PKCS8 PEM\n");
  process.exit(1);
}
try {
  await writeFile(`${index}.sig`, signIndex(await readFile(index), key));
  process.stdout.write(`signed ${index}\n`);
} catch (error) {
  process.stderr.write(`could not sign ${index}: ${error.message}\n`);
  process.exit(1);
}
