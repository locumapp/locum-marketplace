// Validates the catalog, or the files given as arguments, and prints file and field of each error.
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { checkFile, validateCatalog } from "./lib/validate.mjs";
import { checkCodeowners } from "./lib/codeowners.mjs";
import { findForbiddenTerms, parseTerms, termsPath, trackedFiles } from "./lib/forbidden-terms.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = process.argv.slice(2);

const errors = [];
const warnings = [];
let count;
if (files.length === 0) {
  const result = await validateCatalog(root);
  errors.push(...result.errors, ...(await checkCodeowners(root)));
  warnings.push(...result.warnings);
  count = result.items.length;
} else {
  for (const file of files) {
    const checked = await checkFile(resolve(file), { root });
    errors.push(...checked.errors);
    warnings.push(...(checked.warnings ?? []));
  }
  count = files.length;
}

// The list of terms that must not reach this public repository stays on the maintainer's machine.
const listPath = termsPath();
let terms;
try {
  terms = parseTerms(await readFile(listPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  process.stderr.write(`warning: forbidden terms list not found at ${listPath}; skipping the check\n`);
}
if (terms !== undefined) {
  for (const f of await findForbiddenTerms(root, trackedFiles(root), terms)) {
    errors.push({ file: resolve(root, f.file), line: f.line, message: `forbidden term "${f.hint}"` });
  }
}

for (const w of warnings) process.stderr.write(`warning: ${relative(process.cwd(), w.file)}: ${w.field}: ${w.message}\n`);
for (const e of errors) {
  const where = e.line !== undefined ? `:${e.line}` : `: ${e.field === "" ? "(file)" : e.field}`;
  process.stderr.write(`${relative(process.cwd(), e.file)}${where}: ${e.message}\n`);
}
if (errors.length > 0) {
  process.stderr.write(`${errors.length} error(s)\n`);
  process.exit(1);
}
process.stdout.write(`${count} item(s) valid\n`);
