import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedItems, versionErrors } from "../scripts/lib/versions.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const item = (version, text = "x") => ({ kind: "template", id: "a", version, text });

test("a new item starts at version 1", () => {
  assert.deepEqual(versionErrors([{ path: "templates/a.json", status: "A", after: item(1) }]), []);
  const [error] = versionErrors([{ path: "templates/a.json", status: "A", after: item(2) }]);
  assert.equal(error.field, "version");
  assert.match(error.message, /new item starts at version 1/);
});

test("a changed item goes up in version", () => {
  assert.deepEqual(versionErrors([{ path: "templates/a.json", status: "M", before: item(1), after: item(2, "y") }]), []);
  const [same] = versionErrors([{ path: "templates/a.json", status: "M", before: item(3), after: item(3, "y") }]);
  assert.match(same.message, /must go up from 3/);
  const [down] = versionErrors([{ path: "templates/a.json", status: "M", before: item(3), after: item(2, "y") }]);
  assert.match(down.message, /must go up from 3/);
});

test("a removed item needs nothing", () => {
  assert.deepEqual(versionErrors([{ path: "templates/a.json", status: "D", before: item(4) }]), []);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "versions-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "templates"));
  return { dir, git };
}

test("the changes come from git against the merge base, catalog folders only", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "templates/a.json"), JSON.stringify(item(1)));
  writeFileSync(join(dir, "templates/gone.json"), JSON.stringify(item(1)));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("switch", "-q", "-c", "topic");
  writeFileSync(join(dir, "templates/a.json"), JSON.stringify(item(1, "changed")));
  writeFileSync(join(dir, "templates/b.json"), JSON.stringify(item(1)));
  writeFileSync(join(dir, "README.md"), "docs\n");
  rmSync(join(dir, "templates/gone.json"));
  git("add", "-A");
  git("commit", "-q", "-m", "topic");
  const changes = changedItems(dir, "main");
  assert.deepEqual(
    changes.map((c) => [c.path, c.status, c.before?.version, c.after?.version]),
    [
      ["templates/a.json", "M", 1, 1],
      ["templates/b.json", "A", undefined, 1],
      ["templates/gone.json", "D", 1, undefined],
    ],
  );
  assert.equal(versionErrors(changes).length, 1);
});

test("the CLI passes when nothing changed against the base", () => {
  const run = spawnSync(process.execPath, ["scripts/check-versions.mjs", "--base", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});
