import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCatalog, validateFile } from "../scripts/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (path) => join(root, "test", "fixtures", path);

function fieldsOf(errors) {
  return errors.map((e) => e.field);
}

test("the catalog in the repository is valid, with the migrated templates", async () => {
  const { items, errors } = await validateCatalog(root);
  assert.deepEqual(errors, []);
  const templates = items.filter((i) => i.kind === "template").map((i) => i.id);
  assert.ok(templates.includes("pr-review"));
  assert.equal(templates.length, 8);
});

test("good connection fixtures pass: image with digest, npm package with lockfile, remote server", async () => {
  for (const name of ["example-docker", "example-npm", "example-remote"]) {
    assert.deepEqual(await validateFile(fixture(`connections/${name}.json`)), [], name);
  }
});

const bad = [
  ["connections/missing-language.json", "name.pt-BR", /pt-BR/],
  ["connections/id-mismatch.json", "id", /file name/],
  ["connections/npx-without-lockfile.json", "manifest.server.command", /npx.*lockfile/],
  ["connections/image-without-digest.json", "manifest.server.image", /@sha256/],
  ["connections/grafana.json", "id", /built into the app/],
  ["connections/downloaded-script.json", "manifest.server.command", /script/],
  ["connections/install-script.json", "manifest.server.package.lockfile.packages.node_modules/example-mcp.hasInstallScript", /install script/],
  ["connections/credential-in-args.json", "manifest.server.args.1", /\$\{credential\}/],
  ["templates/unknown-agent.json", "package.automacao.spec.steps.0.profile", /ghost/],
  ["templates/wrong-folder.json", "kind", /templates/],
  ["templates/unknown-fields.json", "package.automacao.spec.steps.0.retries", /unknown field/],
  ["templates/unknown-fields.json", "package.automacao.gatilhos.0.channels", /unknown field/],
  ["templates/unknown-fields.json", "package.agents.0.toolsets", /unknown field/],
  ["templates/needs-cycle.json", "package.automacao.spec.steps", /cycle.*write.*post|cycle.*post.*write/],
  ["connections/root-extra-dependency.json", "manifest.server.package.lockfile.packages", /only on example-mcp/],
];

for (const [path, field, message] of bad) {
  test(`rejects ${path} at ${field}`, async () => {
    const errors = await validateFile(fixture(path));
    const hit = errors.find((e) => e.field === field);
    assert.ok(hit, `expected an error at ${field}, got ${JSON.stringify(fieldsOf(errors))}`);
    assert.match(hit.message, message);
    assert.ok(hit.file.endsWith(path));
  });
}

test("the CLI exits non-zero and prints file and field of each error", () => {
  const run = spawnSync(process.execPath, ["scripts/validate.mjs", "test/fixtures/connections/image-without-digest.json"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /test\/fixtures\/connections\/image-without-digest\.json: manifest\.server\.image: /);
});

test("the CLI with no arguments validates the whole catalog and exits zero", () => {
  const env = { ...process.env, LOCUM_TERMOS_PROIBIDOS: join(tmpdir(), "no-such-terms-file") };
  const run = spawnSync(process.execPath, ["scripts/validate.mjs"], { cwd: root, encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
});

function tempCatalog(folder) {
  const catalog = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(join(catalog, folder));
  return catalog;
}

test("connection types are refused in the catalog until the app opens them", async () => {
  const catalog = tempCatalog("connections");
  copyFileSync(fixture("connections/example-docker.json"), join(catalog, "connections/example-docker.json"));
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /connection types are not accepted yet/);
});

test("a symlink in the catalog is refused, even when it points to a valid item", async () => {
  const catalog = tempCatalog("templates");
  symlinkSync(join(root, "templates/slack-reply.json"), join(catalog, "templates/slack-reply.json"));
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items, []);
  assert.match(errors[0].message, /regular file/);
});

/** A copy of a template in the repository with a change, written to a temporary catalog folder. */
function variant(change, folder = "templates", from = "slack-reply") {
  const item = JSON.parse(readFileSync(join(root, `templates/${from}.json`), "utf8"));
  change(item);
  const file = join(tempCatalog(folder), folder, `${item.id}.json`);
  writeFileSync(file, JSON.stringify(item));
  return file;
}

test("a template without a trigger fails at the trigger list", async () => {
  const errors = await validateFile(variant((item) => (item.package.automacao.gatilhos = [])));
  const hit = errors.find((e) => e.field === "package.automacao.gatilhos");
  assert.ok(hit, JSON.stringify(fieldsOf(errors)));
  assert.match(hit.message, /at least one trigger/);
});

test("a package may come without a trigger", async () => {
  const file = variant((item) => {
    item.kind = "package";
    item.package.automacao.gatilhos = [];
  }, "packages");
  assert.deepEqual(await validateFile(file), []);
});

test("a trigger that reads a connection missing from the requirements fails at its kind", async () => {
  const errors = await validateFile(
    variant((item) => {
      item.package.automacao.gatilhos = [{ kind: "poll", source: "github" }];
      item.package.requisitos.conexoes = [{ id: "slack", nome: "Slack" }];
    }),
  );
  const hit = errors.find((e) => e.field === "package.automacao.gatilhos.0.kind");
  assert.ok(hit, JSON.stringify(fieldsOf(errors)));
  assert.match(hit.message, /"poll" trigger reads the "github" connection/);
});

test("an mcp-poll trigger whose server is missing from the requirements fails at its server", async () => {
  const errors = await validateFile(
    variant((item) => {
      item.package.automacao.gatilhos.push({ kind: "mcp-poll", server: "tickets", tool: "list_open" });
      item.package.requisitos.servidores = [];
    }),
  );
  const hit = errors.find((e) => e.field === "package.automacao.gatilhos.1.server");
  assert.ok(hit, JSON.stringify(fieldsOf(errors)));
  assert.match(hit.message, /server "tickets"/);
});

test("a trigger whose connection and server are in the requirements passes", async () => {
  const file = variant((item) => {
    item.package.automacao.gatilhos = [{ kind: "mcp-poll", server: "tickets", tool: "list_open" }, { kind: "cron", expression: "0 9 * * 1-5" }];
    item.package.requisitos.conexoes = [];
    item.package.requisitos.servidores = [{ nome: "tickets" }];
  });
  assert.deepEqual(await validateFile(file), []);
});

async function errorAt(file, field) {
  const errors = await validateFile(file);
  const hit = errors.find((e) => e.field === field);
  assert.ok(hit, `expected an error at ${field}, got ${JSON.stringify(fieldsOf(errors))}`);
  return hit;
}

test("a template that reads the event and only has clock triggers fails at the step that reads it", async () => {
  const file = variant((item) => (item.package.automacao.gatilhos = [{ kind: "cron", expression: "0 9 * * 1-5" }]));
  const hit = await errorAt(file, "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /\{\{event\.\}\}|event/);
  assert.match(hit.message, /no trigger of this template brings an event/);
});

test("a template that reads the event passes when one of its triggers brings one", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "cron", expression: "0 9 * * 1-5" }));
  assert.deepEqual(await validateFile(file), []);
});

test("a template that leaves the GitHub owner out without the omitted entry fails at the owner", async () => {
  const file = variant((item) => (item.package.omitidos = []), "templates", "pr-review");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.owner");
  assert.match(hit.message, /"dono-do-github"/);
});

test("a template that leaves the repositories of a thread reply trigger out without the omitted entry fails at repoMatch", async () => {
  const file = variant((item) => (item.package.omitidos = item.package.omitidos.filter((o) => o.codigo !== "argumentos")), "templates", "pr-thread-reply");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.repoMatch");
  assert.match(hit.message, /"argumentos"/);
});

test("a template with a Teams inbox trigger that does not hold the chats for the person fails at chatsRestritos", async () => {
  const file = variant((item) => delete item.package.automacao.gatilhos[0].chatsRestritos, "templates", "teams-reply");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.chatsRestritos");
  assert.match(hit.message, /chats/);
});

test("every trigger kind in the schema says what the person chooses, and how a template leaves each field out", () => {
  const schema = JSON.parse(readFileSync(join(root, "schemas/template.schema.json"), "utf8"));
  for (const branch of schema.$defs.trigger.allOf) {
    const kind = branch.if.properties.kind.const;
    const chooses = branch.then["x-person-chooses"];
    assert.ok(Array.isArray(chooses), kind);
    // Each field is left out in exactly one way: the app needs it to create the trigger, an omitted entry, or a field that holds the trigger.
    const ways = [branch.then["x-required-to-run"] ?? [], Object.keys(branch.then["x-omitted-code"] ?? {}), Object.keys(branch.then["x-held-by"] ?? {})];
    for (const f of chooses) assert.equal(ways.filter((w) => w.includes(f)).length, 1, `${kind}.${f}`);
    assert.deepEqual(ways.flat().sort(), [...chooses].sort(), kind);
  }
});
