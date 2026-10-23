import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCodeowners } from "../scripts/lib/codeowners.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function withCodeowners(text) {
  const dir = mkdtempSync(join(tmpdir(), "codeowners-"));
  if (text !== undefined) {
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github/CODEOWNERS"), text);
  }
  return dir;
}

const messages = async (dir) => (await checkCodeowners(dir)).map((e) => e.message);

test("the repository CODEOWNERS gives every official connection id to the maintainers", async () => {
  assert.deepEqual(await checkCodeowners(root), []);
});

test("a catalog without CODEOWNERS fails", async () => {
  assert.match((await messages(withCodeowners())).join("\n"), /\.github\/CODEOWNERS is missing/);
});

test("an official id with no owner fails, naming the file", async () => {
  const found = await messages(withCodeowners("/.github/CODEOWNERS @example-maintainer\n/scripts/lib/official-connections.json @example-maintainer\n"));
  assert.ok(found.some((m) => /^connections\/github\.json has no owner/.test(m)), found.join("\n"));
});

test("an official id owned by someone else than the maintainers fails, the last matching line wins", async () => {
  const text = [
    "# maintainers",
    "/.github/CODEOWNERS @example-maintainer",
    "/scripts/lib/official-connections.json @example-maintainer",
    "/connections/ @example-maintainer",
    "/connections/slack.json @example-contributor",
    "",
  ].join("\n");
  assert.deepEqual(await messages(withCodeowners(text)), [
    "connections/slack.json is owned by @example-contributor, not by the maintainers who own .github/CODEOWNERS (@example-maintainer)",
  ]);
});

test("a catch-all line covers every official id", async () => {
  assert.deepEqual(await messages(withCodeowners("* @example-maintainer\n")), []);
});
