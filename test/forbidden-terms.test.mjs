import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findForbiddenTerms, parseTerms } from "../scripts/lib/forbidden-terms.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function termsFile(content) {
  const file = join(mkdtempSync(join(tmpdir(), "terms-")), "termos-proibidos");
  writeFileSync(file, content);
  return file;
}

test("the list takes one term per line, skipping blanks and # comments", () => {
  assert.deepEqual(parseTerms("# empresa\nAcme Corp # cliente\n\n  São Paulo  \n# fim\n"), ["Acme Corp", "São Paulo"]);
});

test("a whole word matches without case or accents, any space matches any space, and the finding has only a hint of the term", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  writeFileSync(join(dir, "a.md"), "first line\nwe worked at ACME\tcorp last year\n");
  writeFileSync(join(dir, "b.md"), "Sao Paulo office\n");
  writeFileSync(join(dir, "c.md"), "a zedoary root by xzed, and acmecorp\n");
  writeFileSync(join(dir, "package-lock.json"), "zed\n");
  writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x00, 0x7a, 0x65, 0x64]));
  const found = await findForbiddenTerms(dir, ["a.md", "b.md", "c.md", "package-lock.json", "logo.png"], ["Acme Corp", "São Paulo", "Zed"]);
  assert.deepEqual(found, [
    { file: "a.md", line: 2, hint: "ac… (9 characters)" },
    { file: "b.md", line: 1, hint: "sa… (9 characters)" },
  ]);
});

test("validate fails on a forbidden term in a tracked file and does not print the term", () => {
  const env = { ...process.env, LOCUM_TERMOS_PROIBIDOS: termsFile("# teste\nASSINATURÁ\n") };
  const run = spawnSync(process.execPath, ["scripts/validate.mjs"], { cwd: root, encoding: "utf8", env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /\.github\/workflows\/publish\.yml:\d+: forbidden term "as… \(10 characters\)"/);
  assert.ok(!run.stderr.toLowerCase().includes("assinatura"), run.stderr);
  assert.ok(!run.stdout.toLowerCase().includes("assinatura"), run.stdout);
});

test("without the list, validate warns and goes on", () => {
  const env = { ...process.env, LOCUM_TERMOS_PROIBIDOS: join(tmpdir(), "no-such-terms-file") };
  const run = spawnSync(process.execPath, ["scripts/validate.mjs"], { cwd: root, encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /forbidden terms list not found/);
});
