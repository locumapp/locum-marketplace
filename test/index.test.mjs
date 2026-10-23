import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../scripts/lib/build-index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AT = { commit: COMMIT, committedAt: 1792000000 };

test("the index is the same, byte for byte, when built twice for the same commit", async () => {
  assert.equal(await buildIndex(root, AT), await buildIndex(root, AT));
});

const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();

test("the CLI writes the same index.json twice in a row, dated by the commit time", () => {
  const out = mkdtempSync(join(tmpdir(), "index-"));
  const head = git("rev-parse", "HEAD");
  const run = () => {
    const r = spawnSync(process.execPath, ["scripts/build-index.mjs", "--commit", head, "--out", join(out, "index.json")], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(join(out, "index.json"));
  };
  const first = run();
  assert.deepEqual(first, run());
  assert.equal(JSON.parse(first).committedAt, Number(git("show", "-s", "--format=%ct", head)));
});

test("the CLI refuses a commit this repository does not have", () => {
  const r = spawnSync(process.execPath, ["scripts/build-index.mjs", "--commit", COMMIT, "--out", join(tmpdir(), "never.json")], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1);
});

test("the index lists every item sorted, with the hash of the file bytes and the commit", async () => {
  const index = JSON.parse(await buildIndex(root, AT));
  assert.equal(index.format, "locum-marketplace-index");
  assert.equal(index.version, 1);
  assert.equal(index.commit, COMMIT);
  assert.equal(index.committedAt, 1792000000);
  assert.deepEqual(Object.keys(index), ["format", "version", "commit", "committedAt", "items"]);
  const kinds = index.items.map((i) => i.kind);
  assert.equal(kinds.lastIndexOf("connection") < kinds.indexOf("template"), true);
  assert.deepEqual(index.items.filter((i) => i.kind === "connection").map((i) => i.id).slice(0, 3), ["amplitude", "asana", "atlassian"]);
  assert.deepEqual(index.items.filter((i) => i.kind === "template").map((i) => i.id).slice(0, 3), ["inbox-triage", "morning-briefing", "observability-watch"]);
  const review = index.items.find((i) => i.id === "pr-review");
  assert.equal(review.path, "templates/pr-review.json");
  assert.equal(review.sha256, createHash("sha256").update(readFileSync(join(root, review.path))).digest("hex"));
  assert.deepEqual(review.name, { en: "PR review", "pt-BR": "Revisão de PR" });
  assert.deepEqual(review.requires, {
    connections: ["github"],
    servers: ["argocd"],
    providers: [{ provider: "claude-code", models: ["claude-opus-5", "claude-sonnet-5"] }],
    skills: [],
    actions: ["github.checks_wait", "github.review_comment"],
    triggers: [{ kind: "poll", choose: ["owner", "repoMatch"] }],
  });
});

test("every template says in requires the triggers it brings, in order, with what the person picks", async () => {
  const index = JSON.parse(await buildIndex(root, AT));
  const triggers = Object.fromEntries(index.items.filter((i) => i.kind === "template").map((i) => [i.id, i.requires.triggers]));
  assert.equal(Object.keys(triggers).length, 9);
  for (const [id, list] of Object.entries(triggers)) assert.ok(list.length > 0, id);
  assert.deepEqual(triggers["support-desk"], [{ kind: "cron", choose: [] }]);
  assert.deepEqual(triggers["teams-reply"], [{ kind: "teams-inbox", choose: ["chats"] }]);
  assert.deepEqual(triggers["pr-thread-reply"], [{ kind: "github-thread-reply", choose: ["owner", "repoMatch"] }]);
  assert.deepEqual(triggers["inbox-triage"], [
    { kind: "slack-inbox", choose: ["myUserId"] },
    { kind: "teams-inbox", choose: ["chats"] },
  ]);
});

test("remote connections reach the index, local ones wait; a connection requires what the install screen shows", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  for (const name of ["example-docker", "example-npm", "example-remote"]) {
    cpSync(join(root, "test/fixtures/connections", `${name}.json`), join(catalog, "connections", `${name}.json`));
  }
  await assert.rejects(buildIndex(catalog, AT), /example-docker\.json: manifest\.servers\.local: local servers are not accepted yet/);
  const index = JSON.parse(await buildIndex(catalog, { ...AT, localServers: true }));
  const requires = Object.fromEntries(index.items.map((i) => [i.id, i.requires]));
  assert.deepEqual(requires["example-docker"], {
    servers: { local: { image: "ghcr.io/example/example-mcp@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } },
    hosts: [],
    methods: [{ type: "token" }],
    scopes: [],
    fields: [],
    triggers: [],
    actions: [],
    writeTools: ["create_item", "delete_item"],
  });
  assert.deepEqual(requires["example-npm"].servers, { local: { package: "example-mcp@1.2.3" } });
  assert.deepEqual(requires["example-remote"], {
    servers: { remote: { url: "https://mcp.example.com/mcp" } },
    hosts: ["api.example.com", "mcp.example.com"],
    methods: [{ type: "oauth" }],
    scopes: ["read", "write"],
    fields: [],
    triggers: [],
    actions: [],
    writeTools: ["post_message"],
  });
});

test("a connection whose address the person fills requires the field, and carries its minAppVersion", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  const item = JSON.parse(readFileSync(join(root, "test/fixtures/connections/example-remote.json"), "utf8"));
  item.id = "grafana";
  item.minAppVersion = "0.2.0";
  item.manifest.fields = [{ key: "url", label: { en: "Address", "pt-BR": "Endereço" }, format: "url", required: true }];
  item.manifest.servers = { remote: { urlField: "url" } };
  item.manifest.triggers = ["mcp-poll"];
  item.manifest.methods.push({ type: "session", reader: "browser-cookie" });
  writeFileSync(join(catalog, "connections/grafana.json"), JSON.stringify(item));
  const [entry] = JSON.parse(await buildIndex(catalog, AT)).items;
  assert.equal(entry.minAppVersion, "0.2.0");
  assert.deepEqual(entry.requires.servers, { remote: { urlField: "url" } });
  assert.deepEqual(entry.requires.hosts, ["api.example.com"]);
  assert.deepEqual(entry.requires.fields, ["url"]);
  assert.deepEqual(entry.requires.triggers, ["mcp-poll"]);
  assert.deepEqual(entry.requires.methods, [{ type: "oauth" }, { type: "session", reader: "browser-cookie" }]);
});

test("an invalid catalog does not become an index", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "connections"));
  cpSync(join(root, "test/fixtures/connections/proprio.json"), join(catalog, "connections/proprio.json"));
  await assert.rejects(buildIndex(catalog, { ...AT, localServers: true }), /proprio\.json: id/);
});

test("the commit must be a full sha", async () => {
  await assert.rejects(buildIndex(root, { commit: "main", committedAt: 1 }), /commit/);
  await assert.rejects(buildIndex(root, { commit: COMMIT, committedAt: "yesterday" }), /committedAt/);
});

test("providers sort by code unit, not by locale", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "templates"));
  const item = JSON.parse(readFileSync(join(root, "templates/slack-reply.json"), "utf8"));
  item.package.requisitos.provedores = [
    { provedor: "anthropic", modelos: ["b", "B"] },
    { provedor: "Zeta", modelos: ["z"] },
  ];
  writeFileSync(join(catalog, "templates/slack-reply.json"), JSON.stringify(item));
  const index = JSON.parse(await buildIndex(catalog, AT));
  assert.deepEqual(index.items[0].requires.providers, [
    { provider: "Zeta", models: ["z"] },
    { provider: "anthropic", models: ["B", "b"] },
  ]);
});

test("the index carries minAppVersion when the item declares it, right after version, and leaves it out otherwise", async () => {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, "templates"));
  for (const [id, minAppVersion] of [["slack-reply", "0.1.10"], ["teams-reply", undefined]]) {
    const item = JSON.parse(readFileSync(join(root, `templates/${id}.json`), "utf8"));
    if (minAppVersion !== undefined) item.minAppVersion = minAppVersion;
    writeFileSync(join(catalog, `templates/${id}.json`), JSON.stringify(item));
  }
  const byId = Object.fromEntries(JSON.parse(await buildIndex(catalog, AT)).items.map((i) => [i.id, i]));
  assert.equal(byId["slack-reply"].minAppVersion, "0.1.10");
  assert.deepEqual(Object.keys(byId["slack-reply"]).slice(0, 4), ["kind", "id", "version", "minAppVersion"]);
  assert.equal("minAppVersion" in byId["teams-reply"], false);
});
