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
  assert.equal(templates.length, 10);
});

test("good connection fixtures pass: image with digest, npm package with lockfile, remote server", async () => {
  for (const name of ["example-docker", "example-npm", "example-remote"]) {
    assert.deepEqual(await validateFile(fixture(`connections/${name}.json`)), [], name);
  }
});

const bad = [
  ["connections/missing-language.json", "name.pt-BR", /pt-BR/],
  ["connections/id-mismatch.json", "id", /file name/],
  ["connections/npx-without-lockfile.json", "manifest.servers.local.command", /npx.*lockfile/],
  ["connections/image-without-digest.json", "manifest.servers.local.image", /@sha256/],
  ["connections/proprio.json", "id", /reserved/],
  ["connections/downloaded-script.json", "manifest.servers.local.command", /script/],
  ["connections/install-script.json", "manifest.servers.local.package.lockfile.packages.node_modules/example-mcp.hasInstallScript", /install script/],
  ["connections/credential-in-args.json", "manifest.servers.local.args.1", /\$\{credential\}/],
  ["templates/unknown-agent.json", "package.automacao.spec.steps.0.profile", /ghost/],
  ["templates/wrong-folder.json", "kind", /templates/],
  ["templates/unknown-fields.json", "package.automacao.spec.steps.0.retries", /unknown field/],
  ["templates/unknown-fields.json", "package.automacao.gatilhos.0.channels", /unknown field/],
  ["templates/unknown-fields.json", "package.agents.0.toolsets", /unknown field/],
  ["templates/needs-cycle.json", "package.automacao.spec.steps", /cycle.*write.*post|cycle.*post.*write/],
  ["connections/root-extra-dependency.json", "manifest.servers.local.package.lockfile.packages", /only on example-mcp/],
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
  assert.match(run.stderr, /test\/fixtures\/connections\/image-without-digest\.json: manifest\.servers\.local\.image: /);
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

test("remote connection types are accepted in the catalog; local servers wait for the app to pin them", async () => {
  const catalog = tempCatalog("connections");
  copyFileSync(fixture("connections/example-remote.json"), join(catalog, "connections/example-remote.json"));
  copyFileSync(fixture("connections/example-docker.json"), join(catalog, "connections/example-docker.json"));
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items.map((i) => i.id), ["example-remote"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "manifest.servers.local");
  assert.match(errors[0].message, /local servers are not accepted yet/);
  assert.deepEqual((await validateCatalog(catalog, { localServers: true })).errors, []);
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
    item.package.automacao.gatilhos = [{ kind: "mcp-poll", server: "tickets", tool: "list_open" }];
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
  assert.match(hit.message, /reads \{\{event\.channel\}\}/);
  assert.match(hit.message, /"cron" brings no event/);
});

const reading = (text) => (item) => {
  item.package.automacao.gatilhos = [{ kind: "cron", expression: "0 9 * * 1-5" }];
  item.package.automacao.spec.steps[0].prompt = `Resumo do dia.\n${text}`;
};

test("the event read with spaces inside the braces counts", async () => {
  const hit = await errorAt(variant(reading("{{ event.text }}")), "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\.text\}\}/);
});

test("the whole event read counts", async () => {
  const hit = await errorAt(variant(reading("{{event}}")), "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\}\}/);
});

test("a template with a trigger that brings an event and one that does not fails when it reads the event", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "cron", expression: "0 9 * * 1-5" }));
  const hit = await errorAt(file, "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /"cron" brings no event/);
});

test("a webhook trigger brings no event, and a manual one does", async () => {
  const webhook = variant((item) => {
    item.package.automacao.gatilhos = [{ kind: "webhook" }];
    item.package.omitidos = [{ codigo: "argumentos", onde: "gatilho:0", params: ["path"] }];
  });
  assert.match((await errorAt(webhook, "package.automacao.spec.steps.0.prompt")).message, /"webhook" brings no event/);
  const manual = variant((item) => (item.package.automacao.gatilhos = [{ kind: "manual" }]));
  assert.deepEqual(await validateFile(manual), []);
});

test("the event in fields the app does not render, like the name, does not count", async () => {
  const file = variant((item) => {
    reading("sem evento")(item);
    item.package.automacao.spec.steps[0].name = "Responder {{event.author}}";
    item.package.automacao.spec.steps[1].params = {};
  });
  assert.deepEqual(await validateFile(file), []);
});

test("a webhook trigger without its path and without the omitted entry fails at the path", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "webhook" }));
  const hit = await errorAt(file, "package.automacao.gatilhos.1.path");
  assert.match(hit.message, /"codigo": "argumentos", "onde": "gatilho:1", "params": \["path"\]/);
});

test("a repository expression that matches everything counts as not chosen", async () => {
  const thread = variant((item) => {
    item.package.automacao.gatilhos[0].repoMatch = ".*";
    item.package.omitidos = item.package.omitidos.filter((o) => o.codigo !== "argumentos");
  }, "templates", "pr-thread-reply");
  assert.match((await errorAt(thread, "package.automacao.gatilhos.0.repoMatch")).message, /"argumentos"/);
  const poll = variant((item) => (item.package.automacao.gatilhos[0].repoMatch = "^.*$"), "templates", "pr-review");
  assert.match((await errorAt(poll, "package.automacao.gatilhos.0.repoMatch")).message, /matches every repository|leave .* out/);
});

test("a template that reads the event passes when every trigger brings one", async () => {
  const file = variant((item) => item.package.automacao.gatilhos.push({ kind: "manual" }));
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
    // The app holds a trigger only for a field it needs to run it.
    for (const f of branch.then["x-pending-choice"] ?? []) assert.ok(ways[0].includes(f), `${kind}.${f}`);
  }
});

test("x-pending-choice marks only what the app holds, the pendingChoice of app/src/config/types.ts", () => {
  // Marking a field the app does not hold lets batch through on a trigger the app drops: change both together.
  const schema = JSON.parse(readFileSync(join(root, "schemas/template.schema.json"), "utf8"));
  const held = Object.fromEntries(
    schema.$defs.trigger.allOf.filter((b) => b.then["x-pending-choice"] !== undefined).map((b) => [b.if.properties.kind.const, b.then["x-pending-choice"]]),
  );
  assert.deepEqual(held, { "slack-channel": ["channels"] });
});

test("a template may declare the minimum app version as x.y.z", async () => {
  assert.deepEqual(await validateFile(variant((item) => (item.minAppVersion = "0.1.10"))), []);
});

for (const bad of ["0.2", "v0.2.0", "0.2.0-beta", "01.2.0", "0.2.0.1", 2]) {
  test(`a template with minAppVersion ${JSON.stringify(bad)} fails at minAppVersion`, async () => {
    const errors = await validateFile(variant((item) => (item.minAppVersion = bad)));
    const hit = errors.find((e) => e.field === "minAppVersion");
    assert.ok(hit, JSON.stringify(fieldsOf(errors)));
    assert.match(hit.message, /x\.y\.z/);
  });
}

/** slack-reply with its inbox trigger in batch, reading what the batch event brings. */
const batched = (change = () => {}) =>
  variant((item) => {
    item.minAppVersion = "0.1.175";
    item.package.automacao.gatilhos[0].batch = { windowMinutes: 60, max: 50 };
    item.package.automacao.spec.steps[0].prompt =
      "Resuma as mensagens.\n{{event.items}}\nDe {{ event.windowStart }} a {{event.windowEnd}}: {{event.count}} decididas, {{event.cut}} cortadas, {{event.deferred}} adiadas.";
    change(item);
  });

test("a trigger with filter takes batch, and the template reads what the batch event brings", async () => {
  assert.deepEqual(await validateFile(batched()), []);
});

for (const [batch, at, message] of [
  [{ windowMinutes: 0, max: 50 }, "windowMinutes", />= 1/],
  [{ windowMinutes: 10081, max: 50 }, "windowMinutes", /<= 10080/],
  [{ windowMinutes: 60, max: 0 }, "max", />= 1/],
  [{ windowMinutes: 60, max: 501 }, "max", /<= 500/],
  [{ windowMinutes: 60, max: 2.5 }, "max", /integer/],
  [{ windowMinutes: 60 }, "max", /required/],
  [{ windowMinutes: 60, max: 50, every: 5 }, "every", /unknown field/],
]) {
  test(`batch ${JSON.stringify(batch)} fails at batch.${at}, with the limits of the app`, async () => {
    const hit = await errorAt(batched((item) => (item.package.automacao.gatilhos[0].batch = batch)), `package.automacao.gatilhos.0.batch.${at}`);
    assert.match(hit.message, message);
  });
}

test("batch on a trigger without filter fails at batch, as the app refuses it", async () => {
  for (const trigger of [{ kind: "cron", expression: "0 9 * * 1-5" }, { kind: "manual" }]) {
    const file = batched((item) => (item.package.automacao.gatilhos = [{ ...trigger, batch: { windowMinutes: 60, max: 50 } }]));
    const hit = await errorAt(file, "package.automacao.gatilhos.0.batch");
    assert.match(hit.message, new RegExp(`"${trigger.kind}" trigger has no filter`));
  }
});

test("with batch, a step that reads a field of a single event fails, because the batch event has no such field", async () => {
  const file = batched((item) => (item.package.automacao.spec.steps[0].prompt += "\nCanal: {{event.channel}}"));
  const hit = await errorAt(file, "package.automacao.spec.steps.0.prompt");
  assert.match(hit.message, /reads \{\{event\.channel\}\}/);
  assert.match(hit.message, /"slack-inbox" has batch/);
});

test("the batch event still counts as no event when a clock trigger starts the run", async () => {
  const file = batched((item) => item.package.automacao.gatilhos.push({ kind: "cron", expression: "0 9 * * 1-5" }));
  assert.match((await errorAt(file, "package.automacao.spec.steps.0.prompt")).message, /"cron" brings no event/);
});

test("batch needs minAppVersion 0.1.175, the first app with batch", async () => {
  for (const version of [undefined, "0.1.174"]) {
    const file = batched((item) => (version === undefined ? delete item.minAppVersion : (item.minAppVersion = version)));
    assert.match((await errorAt(file, "minAppVersion")).message, /batch needs minAppVersion 0\.1\.175/);
  }
});

test("settleMinutes needs minAppVersion 0.1.204, the first app with the trigger settle time", async () => {
  for (const version of [undefined, "0.1.203"]) {
    const file = variant(
      (item) => {
        item.package.automacao.gatilhos[0].settleMinutes = 30;
        if (version === undefined) delete item.minAppVersion;
        else item.minAppVersion = version;
      },
      "templates",
      "pr-rereview",
    );
    assert.match((await errorAt(file, "minAppVersion")).message, /settleMinutes needs minAppVersion 0\.1\.204/);
  }
});

test("the review text marks and myReview.include need minAppVersion 0.1.208", async () => {
  for (const version of [undefined, "0.1.207"]) {
    const file = variant(
      (item) => {
        if (version === undefined) delete item.minAppVersion;
        else item.minAppVersion = version;
      },
      "templates",
      "pr-review",
    );
    assert.match((await errorAt(file, "minAppVersion")).message, /need minAppVersion 0\.1\.208/);
  }
});

/** slack-reply with a batched slack-channel trigger that leaves the channels to choose. */
const channelBatched = (minAppVersion) =>
  batched((item) => {
    item.minAppVersion = minAppVersion;
    item.package.automacao.gatilhos = [{ kind: "slack-channel", everyMinutes: 5, batch: { windowMinutes: 60, max: 50 } }];
    item.package.omitidos = [];
  });

test("batch on a trigger the app holds until the person chooses passes from the app that holds it", async () => {
  assert.deepEqual(await validateFile(channelBatched("0.1.177")), []);
});

test("batch on a trigger the app holds until the person chooses needs minAppVersion 0.1.177, because older apps drop it whole", async () => {
  const hit = await errorAt(channelBatched("0.1.176"), "minAppVersion");
  assert.match(hit.message, /without channels needs minAppVersion 0\.1\.177/);
  assert.match(hit.message, /drop the whole trigger, batch included/);
});

test("batch on a trigger the app only creates after the person chooses fails at batch, because the app drops it whole", async () => {
  const file = batched((item) => {
    item.minAppVersion = "0.1.177";
    item.package.automacao.gatilhos = [{ kind: "poll", source: "github", everyMinutes: 5, batch: { windowMinutes: 60, max: 50 } }];
    item.package.requisitos.conexoes = [{ id: "github", nome: "GitHub" }];
    item.package.omitidos = [{ codigo: "dono-do-github", onde: "gatilho:0" }];
  });
  const hit = await errorAt(file, "package.automacao.gatilhos.0.batch");
  assert.match(hit.message, /without repoMatch/);
  assert.match(hit.message, /drops the whole trigger, batch included/);
});

test("a package keeps batch out of a trigger the app holds, because a package declares no minAppVersion", async () => {
  const file = variant((item) => {
    item.kind = "package";
    delete item.minAppVersion;
    item.package.automacao.gatilhos = [{ kind: "slack-channel", everyMinutes: 5, batch: { windowMinutes: 60, max: 50 } }];
    item.package.omitidos = [];
  }, "packages");
  const hit = await errorAt(file, "package.automacao.gatilhos.0.batch");
  assert.match(hit.message, /without channels/);
});

test("a held trigger and one with an omitted entry keep batch: the app creates them with the whole config", async () => {
  const file = batched((item) => {
    item.package.automacao.gatilhos.push({ kind: "teams-inbox", mentions: true, chatsRestritos: 1, batch: { windowMinutes: 30, max: 50 } });
    item.package.requisitos.conexoes.push({ id: "teams", nome: "Microsoft Teams" });
  });
  assert.deepEqual(await validateFile(file), []);
});

test("a template where one trigger that brings an event has batch and another has not fails at the one without", async () => {
  const file = batched((item) => {
    item.package.automacao.gatilhos.push({ kind: "teams-inbox", mentions: true, chatsRestritos: 1 });
    item.package.requisitos.conexoes.push({ id: "teams", nome: "Microsoft Teams" });
  });
  const hit = await errorAt(file, "package.automacao.gatilhos.1.batch");
  assert.match(hit.message, /"slack-inbox" has batch/);
  assert.match(hit.message, /no prompt serves both/);
  assert.match(hit.message, /Batch all the triggers/);
});

test("a manual trigger next to a batched one fails telling to remove it, since manual takes no batch", async () => {
  const file = batched((item) => item.package.automacao.gatilhos.push({ kind: "manual" }));
  const hit = await errorAt(file, "package.automacao.gatilhos.1.batch");
  assert.match(hit.message, /"manual" trigger takes no batch: remove it/);
});

/** slack-reply with a filter on its inbox trigger. */
const filtered = (filter) => variant((item) => (item.package.automacao.gatilhos[0].filter = filter));

test("a filter with the conditions of the app passes", async () => {
  const conditions = [
    { path: "author", compare: "not_equals", against: "{{ event.channel }}" },
    { path: "text", compare: "matches", against: "^deploy\\b" },
    { path: "thread-ts" },
  ];
  assert.deepEqual(await validateFile(filtered(conditions)), []);
});

for (const [condition, at, message] of [
  [{ path: "author..login" }, "path", /pattern/],
  [{ path: "author", compare: "like" }, "compare", /must be one of/],
  [{ path: "author", against: "x".repeat(501) }, "against", /500/],
  [{ path: "author", against: "\u{1F600}".repeat(300) }, "against", /UTF-16/],
  [{ path: "author", against: "{{steps.read.text}}" }, "against", /only event markers/],
  [{ path: "author", compare: "matches", against: "(" }, "against", /regular expression/],
  [{ path: "author", value: "x" }, "value", /unknown field/],
  [{ compare: "exists" }, "path", /required/],
]) {
  test(`filter condition ${JSON.stringify(condition)} fails at filter.0.${at}`, async () => {
    const hit = await errorAt(filtered([condition]), `package.automacao.gatilhos.0.filter.0.${at}`);
    assert.match(hit.message, message);
  });
}

test("a filter with more than 20 conditions fails at the filter", async () => {
  const hit = await errorAt(filtered(Array.from({ length: 21 }, () => ({ path: "author" }))), "package.automacao.gatilhos.0.filter");
  assert.match(hit.message, /20/);
});

/** A connection fixture with a change, written to a temporary connections/ folder under its id. */
function connection(change, from = "example-remote", catalog = tempCatalog("connections")) {
  const item = JSON.parse(readFileSync(fixture(`connections/${from}.json`), "utf8"));
  change(item, item.manifest);
  const file = join(catalog, "connections", `${item.id}.json`);
  writeFileSync(file, JSON.stringify(item));
  return { catalog, file };
}

const remote = (url) => (_, m) => {
  m.servers.remote.url = url;
};

const badConnections = [
  ["a url that carries the credential", remote("https://mcp.example.com/mcp?key=${credential}"), "manifest.servers.remote.url", /\$\{credential\}.*header/],
  ["a url with any other placeholder", remote("https://${host}/mcp"), "manifest.servers.remote.url", /placeholder/],
  ["a url with userinfo", remote("https://user:secret@mcp.example.com/mcp"), "manifest.servers.remote.url", /user/],
  ["a plain http url", remote("http://mcp.example.com/mcp"), "manifest.servers.remote.url", /https/],
  ["localhost", remote("https://localhost/mcp"), "manifest.servers.remote.url", /public/],
  ["a loopback address", remote("https://127.0.0.1/mcp"), "manifest.servers.remote.url", /public/],
  ["a private range", remote("https://10.0.0.5/mcp"), "manifest.servers.remote.url", /public/],
  ["the cloud metadata endpoint", remote("https://169.254.169.254/latest"), "manifest.servers.remote.url", /public/],
  ["IPv6 loopback", remote("https://[::1]/mcp"), "manifest.servers.remote.url", /public/],
  ["a .local name", remote("https://printer.local/mcp"), "manifest.servers.remote.url", /public/],
  ["an internal name", remote("https://metadata.google.internal/mcp"), "manifest.servers.remote.url", /public/],
  ["a single-label name", remote("https://intranet/mcp"), "manifest.servers.remote.url", /public/],
  ["a host that is not public", (_, m) => (m.hosts = ["localhost"]), "manifest.hosts.0", /public/],
  ["a urlField that is not a declared field", (_, m) => (m.servers.remote = { urlField: "address" }), "manifest.servers.remote.urlField", /declared/],
  [
    "a urlField that is not a required url",
    (_, m) => {
      m.fields = [{ key: "address", label: { en: "Address", "pt-BR": "Endereço" }, format: "text", required: true }];
      m.servers.remote = { urlField: "address" };
    },
    "manifest.servers.remote.urlField",
    /required url/,
  ],
  ["the credential outside a header or env", (_, m) => (m.fields = [{ key: "url", label: { en: "${credential}", "pt-BR": "x" }, format: "url", required: true }]), "manifest.fields.0.label.en", /\$\{credential\}/],
  ["another placeholder in a header", (_, m) => (m.servers.remote.headers = { Authorization: "Bearer ${token}" }), "manifest.servers.remote.headers.Authorization", /placeholder/],
  ["a cli method outside an official type", (_, m) => m.methods.push({ type: "cli", reader: "gh" }), "manifest.methods.1", /official/],
  ["a session method outside an official type", (_, m) => m.methods.push({ type: "session", reader: "browser-cookie" }), "manifest.methods.1", /official/],
  ["the same method twice", (_, m) => m.methods.push({ type: "oauth" }), "manifest.methods.1", /twice/],
  ["a trigger kind the app does not have", (_, m) => (m.triggers = ["no-such-kind"]), "manifest.triggers.0", /unknown trigger kind/],
  ["a trigger that reads another connection", (_, m) => (m.triggers = ["poll"]), "manifest.triggers.0", /reads the "github" connection/],
  ["a trigger that reads no connection", (_, m) => (m.triggers = ["cron"]), "manifest.triggers.0", /reads no connection/],
  ["an action of another type", (_, m) => (m.actions = ["other.post"]), "manifest.actions.0", /example-remote\./],
  ["a scope key of another type", (_, m) => (m.scopeKeys = [{ key: "other.repo", normalize: "exact", description: { en: "x", "pt-BR": "x" } }]), "manifest.scopeKeys.0.key", /example-remote\./],
  ["a type that does nothing", (_, m) => delete m.servers, "manifest.servers", /servers, triggers or actions/],
];

for (const [name, change, at, message] of badConnections) {
  test(`a remote connection is refused with ${name}`, async () => {
    const errors = await validateFile(connection(change).file);
    const hit = errors.find((e) => e.field === at);
    assert.ok(hit, `expected an error at ${at}, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, message);
  });
}

const badLocal = [
  ["an env name that changes how code loads", (_, m) => (m.servers.local.env = { NODE_OPTIONS: "--require x" }), "manifest.servers.local.env.NODE_OPTIONS", /loads code/],
  ["a DYLD_ variable", (_, m) => (m.servers.local.env = { DYLD_INSERT_LIBRARIES: "x" }), "manifest.servers.local.env.DYLD_INSERT_LIBRARIES", /loads code/],
  ["the credential in a loader variable", (_, m) => (m.methods[0].env = "LD_PRELOAD"), "manifest.methods.0.env", /loads code/],
  ["an image with a tag and a digest", (_, m) => (m.servers.local.image = `ghcr.io/example/example-mcp:latest@sha256:${"0".repeat(64)}`), "manifest.servers.local.image", /tag/],
  ["an argument that widens the container", (_, m) => (m.servers.local.args = ["--privileged"]), "manifest.servers.local.args.0", /container/],
  ["a volume argument", (_, m) => (m.servers.local.args = ["-v", "/:/host"]), "manifest.servers.local.args.0", /container/],
  ["a volume argument with the value attached", (_, m) => (m.servers.local.args = ["-v/:/host"]), "manifest.servers.local.args.0", /container/],
  ["a long volume argument with its value", (_, m) => (m.servers.local.args = ["--volume=/:/host"]), "manifest.servers.local.args.0", /container/],
  ["NODE_TLS_REJECT_UNAUTHORIZED", (_, m) => (m.servers.local.env = { NODE_TLS_REJECT_UNAUTHORIZED: "0" }), "manifest.servers.local.env.NODE_TLS_REJECT_UNAUTHORIZED", /loads code/],
  ["SSLKEYLOGFILE", (_, m) => (m.servers.local.env = { SSLKEYLOGFILE: "/tmp/keys" }), "manifest.servers.local.env.SSLKEYLOGFILE", /loads code/],
  ["ELECTRON_RUN_AS_NODE", (_, m) => (m.servers.local.env = { ELECTRON_RUN_AS_NODE: "1" }), "manifest.servers.local.env.ELECTRON_RUN_AS_NODE", /loads code/],
];

for (const [name, change, at, message] of badLocal) {
  test(`a local server is refused with ${name}`, async () => {
    const errors = await validateFile(connection(change, "example-docker").file);
    const hit = errors.find((e) => e.field === at);
    assert.ok(hit, `expected an error at ${at}, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, message);
  });
}

test("a lockfile entry resolved outside the npm registry is refused", async () => {
  const at = "manifest.servers.local.package.lockfile.packages.node_modules/example-mcp.resolved";
  const { file } = connection((_, m) => {
    m.servers.local.package.lockfile.packages["node_modules/example-mcp"].resolved = "https://registry.example.com/example-mcp/-/example-mcp-1.2.3.tgz";
  }, "example-npm");
  const hit = (await validateFile(file)).find((e) => e.field === at);
  assert.ok(hit);
  assert.match(hit.message, /registry\.npmjs\.org/);
});

test("an official type may use the cli and session readers, the core triggers that read it, and minAppVersion", async () => {
  const { file } = connection((item, m) => {
    item.id = "github";
    item.minAppVersion = "0.2.0";
    m.methods = [{ type: "token", header: "Authorization" }, { type: "cli", reader: "gh" }];
    m.servers = { remote: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${credential}" } } };
    m.hosts = ["api.githubcopilot.com", "githubcopilot.com"];
    m.triggers = ["poll", "github-thread-reply", "mcp-poll"];
    m.actions = ["github.react"];
    m.trackers = ["github-issues"];
  });
  assert.deepEqual(await validateFile(file), []);
});

test("a remote server whose address the person fills passes, with the field declared", async () => {
  const { file } = connection((_, m) => {
    m.fields = [{ key: "url", label: { en: "Address", "pt-BR": "Endereço" }, help: { en: "The https address.", "pt-BR": "O endereço https." }, format: "url", required: true }];
    m.methods = [{ type: "token", header: "Authorization" }, { type: "none" }];
    m.servers = { remote: { urlField: "url", headers: { Authorization: "Bearer ${credential}" } } };
    delete m.hosts;
  });
  assert.deepEqual(await validateFile(file), []);
});

const urlField = { key: "url", label: { en: "Address", "pt-BR": "Endereço" }, format: "url", required: true };
const textField = (key) => ({ key, label: { en: "Value", "pt-BR": "Valor" }, format: "text", required: true });

test("a remote server takes a path after the address the person fills, and field markers in the url path and headers", async () => {
  const withPath = connection((item, m) => {
    item.minAppVersion = "0.1.170";
    m.fields = [urlField];
    m.methods = [{ type: "token", header: "Authorization" }, { type: "none" }];
    m.servers = { remote: { urlField: "url", path: "/api/mcp", headers: { Authorization: "Bearer ${credential}", "X-Origin": "${field:url}" } } };
    delete m.hosts;
  });
  assert.deepEqual(await validateFile(withPath.file), []);
  const inPath = connection((item, m) => {
    item.minAppVersion = "0.1.170";
    m.fields = [textField("workspace")];
    m.servers.remote = { url: "https://mcp.example.com/w/${field:workspace}/mcp", headers: { "X-Workspace": "${field:workspace}" } };
  });
  assert.deepEqual(await validateFile(inPath.file), []);
});

const markerConnections = [
  ["a path without urlField", (_, m) => (m.servers.remote.path = "/mcp"), "manifest.servers.remote.path", /urlField/],
  [
    "a path with a .. segment",
    (_, m) => {
      m.fields = [urlField];
      m.servers.remote = { urlField: "url", path: "/a/../mcp" };
    },
    "manifest.servers.remote.path",
    /\.\./,
  ],
  [
    "a marker in the path",
    (_, m) => {
      m.fields = [urlField];
      m.servers.remote = { urlField: "url", path: "/${field:url}" };
    },
    "manifest.servers.remote.path",
    /pattern/,
  ],
  [
    "a field marker in the host",
    (_, m) => {
      m.fields = [textField("tenant")];
      m.servers.remote.url = "https://${field:tenant}.example.com/mcp";
    },
    "manifest.servers.remote.url",
    /only in the path/,
  ],
  [
    "a field marker in the query",
    (_, m) => {
      m.fields = [textField("tenant")];
      m.servers.remote.url = "https://mcp.example.com/mcp?t=${field:tenant}";
    },
    "manifest.servers.remote.url",
    /only in the path/,
  ],
  ["a field marker of a field not declared", (_, m) => (m.servers.remote.headers = { "X-Tenant": "${field:tenant}" }), "manifest.servers.remote.headers.X-Tenant", /not a declared field/],
  ["a marker left open", (_, m) => (m.servers.remote.headers = { "X-Tenant": "${field:tenant" }), "manifest.servers.remote.headers.X-Tenant", /placeholder/],
  [
    "the credential in two headers",
    (_, m) => (m.servers.remote.headers = { Authorization: "Bearer ${credential}", "X-Api-Key": "${credential}" }),
    "manifest.servers.remote.headers",
    /one place/,
  ],
  [
    "a token method that puts the credential in another header",
    (_, m) => {
      m.methods = [{ type: "token", header: "X-Api-Key" }];
      m.servers.remote.headers = { Authorization: "Bearer ${credential}" };
    },
    "manifest.methods",
    /X-Api-Key.*Authorization/,
  ],
  [
    "a free text field in a header next to the credential",
    (_, m) => {
      m.fields = [textField("host")];
      m.methods = [{ type: "token", header: "Authorization" }];
      m.servers.remote.headers = { Authorization: "Bearer ${credential}", "X-Host": "${field:host}" };
    },
    "manifest.servers.remote",
    /free text/,
  ],
];

for (const [name, change, at, message] of markerConnections) {
  test(`a remote connection is refused with ${name}`, async () => {
    const errors = await validateFile(connection(change).file);
    const hit = errors.find((e) => e.field === at);
    assert.ok(hit, `expected an error at ${at}, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, message);
  });
}

const healthCheck = [
  { path: "/api/health", fields: [{ key: "version", label: { en: "Version", "pt-BR": "Versão" } }] },
  { path: "/api/user", fields: [{ key: "login", label: { en: "User", "pt-BR": "Usuário" } }, { key: "org_id", label: { en: "Organization", "pt-BR": "Organização" } }] },
];

test("a field takes a placeholder, and a remote server takes a health check, at a fixed url or at the one the person fills", async () => {
  const fixed = connection((item, m) => {
    item.minAppVersion = "0.1.182";
    m.fields = [{ ...textField("team"), required: false, placeholder: { en: "e.g. core", "pt-BR": "ex.: core" } }];
    m.healthCheck = healthCheck;
  });
  assert.deepEqual(await validateFile(fixed.file), []);
  const filled = connection((item, m) => {
    item.minAppVersion = "0.1.182";
    m.fields = [{ ...urlField, placeholder: { en: "https://example.com", "pt-BR": "https://exemplo.com" } }];
    m.methods = [{ type: "token", header: "Authorization" }];
    m.servers = { remote: { urlField: "url", path: "/mcp", headers: { Authorization: "Bearer ${credential}" } } };
    m.healthCheck = [healthCheck[0]];
    delete m.hosts;
  });
  assert.deepEqual(await validateFile(filled.file), []);
});

test("placeholder and healthCheck need the app that reads them: older apps would show the type as invalid", async () => {
  for (const change of [
    (_, m) => (m.fields = [{ ...textField("team"), placeholder: { en: "core", "pt-BR": "core" } }]),
    (_, m) => (m.healthCheck = healthCheck),
  ]) {
    const errors = await validateFile(connection((item, m) => {
      item.minAppVersion = "0.1.181";
      change(item, m);
    }).file);
    const hit = errors.find((e) => e.field === "minAppVersion");
    assert.ok(hit, `expected an error at minAppVersion, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, /0\.1\.182/);
  }
});

const get = (path, ...keys) => ({ path, fields: (keys.length > 0 ? keys : ["version"]).map((key) => ({ key, label: { en: key, "pt-BR": key } })) });

const badHealthChecks = [
  ["a .. segment in the path", (_, m) => (m.healthCheck = [get("/api/../admin")]), "manifest.healthCheck.0.path", /\.\./],
  ["a . segment in the path", (_, m) => (m.healthCheck = [get("/./health")]), "manifest.healthCheck.0.path", /\.\./],
  ["a path without the leading slash", (_, m) => (m.healthCheck = [get("api/health")]), "manifest.healthCheck.0.path", /pattern/],
  ["a full url as the path", (_, m) => (m.healthCheck = [get("https://other.example.com/health")]), "manifest.healthCheck.0.path", /pattern/],
  ["a query in the path", (_, m) => (m.healthCheck = [get("/health?verbose=1")]), "manifest.healthCheck.0.path", /pattern/],
  ["a fragment in the path", (_, m) => (m.healthCheck = [get("/health#top")]), "manifest.healthCheck.0.path", /pattern/],
  ["a marker in the path", (_, m) => (m.healthCheck = [get("/${field:url}")]), "manifest.healthCheck.0.path", /pattern/],
  ["an empty list", (_, m) => (m.healthCheck = []), "manifest.healthCheck", /fewer than 1/],
  ["more than three GETs", (_, m) => (m.healthCheck = ["/a", "/b", "/c", "/d"].map((p) => get(p))), "manifest.healthCheck", /more than 3/],
  ["the same path twice", (_, m) => (m.healthCheck = [get("/health"), get("/health", "status")]), "manifest.healthCheck.1.path", /twice/],
  ["a GET without fields", (_, m) => (m.healthCheck = [{ path: "/health", fields: [] }]), "manifest.healthCheck.0.fields", /fewer than 1/],
  ["more than ten fields", (_, m) => (m.healthCheck = [get("/health", ...Array.from({ length: 11 }, (_, i) => `f${i}`))]), "manifest.healthCheck.0.fields", /more than 10/],
  ["the same field twice in a GET", (_, m) => (m.healthCheck = [get("/health", "version", "version")]), "manifest.healthCheck.0.fields.1.key", /twice/],
  ["a nested field key", (_, m) => (m.healthCheck = [get("/health", "build.version")]), "manifest.healthCheck.0.fields.0.key", /pattern/],
  ["a field without a label", (_, m) => (m.healthCheck = [{ path: "/health", fields: [{ key: "version" }] }]), "manifest.healthCheck.0.fields.0.label", /required/],
  ["an unknown key in a GET", (_, m) => (m.healthCheck = [{ ...get("/health"), method: "POST" }]), "manifest.healthCheck.0.method", /unknown field/],
  ["a placeholder that is not a text in both languages", (_, m) => (m.fields = [{ ...textField("team"), placeholder: "core" }]), "manifest.fields.0.placeholder", /object/],
];

for (const [name, change, at, message] of badHealthChecks) {
  test(`a health check or a placeholder is refused with ${name}`, async () => {
    const errors = await validateFile(connection(change).file);
    const hit = errors.find((e) => e.field === at);
    assert.ok(hit, `expected an error at ${at}, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, message);
  });
}

test("a health check without servers.remote is refused: the base of the GET is the address of the remote server", async () => {
  const errors = await validateFile(connection((_, m) => (m.healthCheck = [get("/health")]), "example-docker").file);
  const hit = errors.find((e) => e.field === "manifest.healthCheck");
  assert.ok(hit, `expected an error at manifest.healthCheck, got ${JSON.stringify(errors)}`);
  assert.match(hit.message, /servers\.remote/);
});

const markerLocal = [
  ["an unknown placeholder in an argument", (_, m) => (m.servers.local.args = ["--org", "${org}"]), "manifest.servers.local.args.1", /placeholder/],
  ["an unknown placeholder in env", (_, m) => (m.servers.local.env.EXAMPLE_ORG = "${org}"), "manifest.servers.local.env.EXAMPLE_ORG", /placeholder/],
  [
    "a free text field in env next to the credential",
    (_, m) => {
      m.fields = [textField("host")];
      m.servers.local.env.EXAMPLE_HOST = "${field:host}";
    },
    "manifest.servers.local",
    /free text/,
  ],
  ["a token method that puts the credential in another variable", (_, m) => (m.methods = [{ type: "token", env: "OTHER_TOKEN" }]), "manifest.methods", /OTHER_TOKEN.*EXAMPLE_TOKEN/],
  ...["DOCKER_HOST", "HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"].map((name) => [
    `the variable ${name}`,
    (_, m) => (m.servers.local.env[name] = "x"),
    `manifest.servers.local.env.${name}`,
    /docker|MCP client|loads code/,
  ]),
  ["DOCKER_CONFIG as the variable of the token", (_, m) => (m.methods[0].env = "DOCKER_CONFIG"), "manifest.methods.0.env", /docker/],
];

for (const [name, change, at, message] of markerLocal) {
  test(`a local server is refused with ${name}`, async () => {
    const errors = await validateFile(connection(change, "example-docker").file);
    const hit = errors.find((e) => e.field === at);
    assert.ok(hit, `expected an error at ${at}, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, message);
  });
}

test("an official type is refused with a free text field in the server that receives the credential, as in the app", async () => {
  const { file } = connection((item, m) => {
    item.id = "grafana";
    item.minAppVersion = "0.1.170";
    m.fields = [urlField, textField("org")];
    m.servers.local.env = { GRAFANA_URL: "${field:url}", GRAFANA_ORG: "${field:org}", EXAMPLE_TOKEN: "${credential}" };
  }, "example-docker");
  const hit = await errorAt(file, "manifest.servers.local");
  assert.match(hit.message, /free text/);
});

test("a path or a field marker needs minAppVersion 0.1.170, the first app whose schema takes them", async () => {
  const withPath = (version) =>
    connection((item, m) => {
      item.minAppVersion = version;
      m.fields = [urlField];
      m.servers = { remote: { urlField: "url", path: "/mcp" } };
      delete m.hosts;
    }).file;
  assert.match((await errorAt(withPath("0.1.169"), "minAppVersion")).message, /0\.1\.170/);
  assert.deepEqual(await validateFile(withPath("0.1.170")), []);
  const withMarker = connection((_, m) => {
    m.fields = [textField("workspace")];
    m.servers.remote.url = "https://mcp.example.com/w/${field:workspace}/mcp";
  }).file;
  assert.match((await errorAt(withMarker, "minAppVersion")).message, /0\.1\.170/);
});

test("a community type cannot take the display name of an official or reserved type, in any case or accent", async () => {
  const named = (en, pt) => connection((item) => (item.name = { en, "pt-BR": pt })).file;
  assert.match((await errorAt(named("Example", "github"), "name.pt-BR")).message, /official type "github"/);
  assert.match((await errorAt(named("Microsoft Teams", "Exemplo"), "name.en")).message, /official type "teams"/);
  assert.match((await errorAt(named("Example", "Servidor Proprio"), "name.pt-BR")).message, /"proprio"/);
  assert.deepEqual(await validateFile(named("GitHub helper", "Ajudante do GitHub")), []);
});

test("the package of a local server identifies the type, like the packages list", async () => {
  const catalog = tempCatalog("connections");
  connection(() => {}, "example-npm", catalog);
  connection((_, m) => (m.packages = ["example-mcp"]), "example-remote", catalog);
  const { errors } = await validateCatalog(catalog, { localServers: true });
  assert.deepEqual(errors.map((e) => [e.file.split("/").pop(), e.field]).sort(), [
    ["example-npm.json", "manifest.servers.local.package.name"],
    ["example-remote.json", "manifest.packages"],
  ]);
});

test("in the catalog, an official type may run an image pinned by digest; a package or a community local server waits", async () => {
  const catalog = tempCatalog("connections");
  connection((item) => (item.id = "grafana"), "example-docker", catalog);
  connection((item) => (item.id = "teams"), "example-npm", catalog);
  connection(() => {}, "example-docker", catalog);
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items.map((i) => i.id), ["grafana"]);
  assert.deepEqual(errors.map((e) => [e.file.split("/").pop(), e.field]), [
    ["example-docker.json", "manifest.servers.local"],
    ["teams.json", "manifest.servers.local"],
  ]);
  assert.match(errors[0].message, /not accepted yet/);
  assert.match(errors[1].message, /package/);
});

test("every official type that shipped in the app is published, argocd, which never did, is not, and prelo is a third-party type", async () => {
  const { items } = await validateCatalog(root);
  const official = JSON.parse(readFileSync(join(root, "scripts/lib/official-connections.json"), "utf8")).official;
  const published = items.filter((i) => i.kind === "connection").map((i) => i.id);
  assert.deepEqual(published, [...Object.keys(official).filter((id) => id !== "argocd"), "prelo"].sort());
  for (const item of items.filter((i) => i.kind === "connection" && i.id !== "prelo")) {
    assert.deepEqual([...new Set(Object.values(item.item.name))].sort(), [...official[item.id].names].sort(), item.id);
  }
});

test("prelo validates as a third-party type: a method that only official types use is refused", async () => {
  const preloWith = (methods) => {
    const item = JSON.parse(readFileSync(join(root, "connections/prelo.json"), "utf8"));
    item.manifest.methods = methods;
    const file = join(tempCatalog("connections"), "connections/prelo.json");
    writeFileSync(file, JSON.stringify(item));
    return file;
  };
  assert.deepEqual(await validateFile(preloWith([{ type: "token" }, { type: "none" }])), []);
  const hit = (await validateFile(preloWith([{ type: "token" }, { type: "cli", reader: "gh" }]))).find((e) => e.field === "manifest.methods.1");
  assert.ok(hit);
  assert.match(hit.message, /only official/);
});

test("an item cannot declare itself official: the index marks it from the maintainers' list", async () => {
  for (const value of [true, false]) {
    const { file } = connection((item) => {
      item.id = "github";
      item.official = value;
    });
    const errors = await validateFile(file);
    assert.deepEqual(errors.map((e) => e.field), ["official"]);
    assert.match(errors[0].message, /official-connections\.json/);
  }
  const errors = await validateFile(variant((item) => (item.official = true)));
  assert.deepEqual(errors.map((e) => e.field), ["official"]);
});

test("two connection types cannot claim the same host or alias, and the error points to both files", async () => {
  const { catalog } = connection((item, m) => {
    item.id = "example-a";
    m.aliases = ["shared-name"];
  });
  connection((item, m) => {
    item.id = "example-b";
    m.servers.remote.url = "https://other.example.com/mcp";
    m.hosts = ["api.example.com", "other.example.com"];
    m.aliases = ["shared-name", "example-a"];
  }, "example-remote", catalog);
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items, []);
  const messages = errors.map((e) => `${e.file.split("/").slice(-2).join("/")}: ${e.field}: ${e.message}`);
  const has = (re) => assert.ok(messages.some((m) => re.test(m)), messages.join("\n"));
  has(/^connections\/example-b\.json: manifest\.hosts: host "api\.example\.com" is already claimed by example-a \(connections\/example-a\.json\)/);
  has(/^connections\/example-a\.json: manifest\.hosts: host "api\.example\.com" is also claimed by example-b \(connections\/example-b\.json\)/);
  has(/^connections\/example-b\.json: manifest\.aliases: alias "shared-name" is already claimed by example-a/);
  has(/^connections\/example-a\.json: manifest\.aliases: alias "shared-name" is also claimed by example-b/);
  has(/^connections\/example-b\.json: manifest\.aliases: alias "example-a" is the id of another type/);
});

test("a community type cannot take an alias of an official one as its id", async () => {
  const errors = await validateFile(connection((item) => (item.id = "ms365")).file);
  const hit = errors.find((e) => e.field === "id");
  assert.ok(hit, JSON.stringify(errors));
  assert.match(hit.message, /alias of the official type "teams"/);
});

test("a connection type needs minAppVersion 0.1.168 or newer, compared as numbers", async () => {
  const errors = await validateFile(connection((item) => (item.minAppVersion = "0.1.167")).file);
  const hit = errors.find((e) => e.field === "minAppVersion");
  assert.ok(hit, JSON.stringify(errors));
  assert.match(hit.message, /0\.1\.168/);
  assert.deepEqual(await validateFile(connection((item) => (item.minAppVersion = "0.1.1000")).file), []);
});

test("-vv and other short flags that are not a volume pass as server arguments", async () => {
  assert.deepEqual(await validateFile(connection((_, m) => (m.servers.local.args = ["-vv", "-verbose"]), "example-docker").file), []);
});

test("a connection type must declare minAppVersion", async () => {
  const errors = await validateFile(connection((item) => delete item.minAppVersion).file);
  assert.ok(errors.some((e) => e.field === "minAppVersion" && /required/.test(e.message)), JSON.stringify(errors));
});

for (const [name, url] of [
  ["a homograph host", "https://mcp.sl\u0430ck.com/mcp"],
  ["a host with a trailing dot", "https://mcp.slack.com./mcp"],
  ["a host in capitals", "https://MCP.example.com/mcp"],
]) {
  test(`a remote connection is refused with ${name}, written differently from its canonical form`, async () => {
    const errors = await validateFile(connection(remote(url)).file);
    const hit = errors.find((e) => e.field === "manifest.servers.remote.url");
    assert.ok(hit, JSON.stringify(errors));
    assert.match(hit.message, /canonical/);
  });
}

for (const suffix of ["corp", "intranet", "private", "home", "test", "example", "invalid", "localdomain"]) {
  test(`a remote connection is refused on the private suffix .${suffix}`, async () => {
    const hit = (await validateFile(connection(remote(`https://mcp.${suffix}/mcp`)).file)).find((e) => e.field === "manifest.servers.remote.url");
    assert.ok(hit);
    assert.match(hit.message, /public/);
  });
}

test("trackers and actions must be kinds the app core has", async () => {
  const errors = await validateFile(connection((_, m) => {
    m.trackers = ["no-such-tracker"];
    m.actions = ["example-remote.post"];
  }).file);
  assert.match(errors.find((e) => e.field === "manifest.trackers.0")?.message ?? "", /unknown tracker kind/);
  assert.match(errors.find((e) => e.field === "manifest.actions.0")?.message ?? "", /unknown action/);
});

test("a community type cannot claim what belongs to an official one", async () => {
  const { catalog } = connection((_, m) => {
    m.servers.remote.url = "https://mcp.slack.com/mcp";
    delete m.hosts;
    m.aliases = ["ms365"];
    m.trackers = ["jira"];
  });
  const { errors } = await validateCatalog(catalog);
  const messages = errors.map((e) => `${e.field}: ${e.message}`);
  assert.ok(messages.some((m) => /^manifest\.servers\.remote\.url: host "mcp\.slack\.com" is already claimed by slack/.test(m)), messages.join("\n"));
  assert.ok(messages.some((m) => /^manifest\.aliases: alias "ms365" is already claimed by teams/.test(m)), messages.join("\n"));
  assert.ok(messages.some((m) => /^manifest\.trackers: tracker "jira" is already claimed by atlassian/.test(m)), messages.join("\n"));
});

test("a remote server on a host left out of hosts is refused, as the app refuses to install it", async () => {
  const errors = await validateFile(connection((_, m) => (m.hosts = ["api.example.com"])).file);
  const hit = errors.find((e) => e.field === "manifest.servers.remote.url");
  assert.ok(hit, JSON.stringify(errors));
  assert.match(hit.message, /"mcp\.example\.com" is not in manifest\.hosts/);
});

const declaredHosts = [
  ["without hosts", (_, m) => delete m.hosts],
  ["with a port in the url", (_, m) => (m.servers.remote.url = "https://mcp.example.com:8443/mcp")],
  [
    "with a field marker in the path",
    (_, m) => {
      m.fields = [{ key: "workspace", label: { en: "Workspace", "pt-BR": "Espaço" }, format: "url", required: true }];
      m.servers.remote.url = "https://mcp.example.com/${field:workspace}/mcp";
    },
  ],
];

for (const [name, change] of declaredHosts) {
  test(`a remote server whose host is declared, or with no hosts at all, passes ${name}`, async () => {
    const errors = await validateFile(connection((item, m) => {
      item.minAppVersion = "0.1.170";
      change(item, m);
    }).file);
    assert.deepEqual(errors.filter((e) => e.field === "manifest.servers.remote.url"), []);
  });
}

const hiddenText = [
  ["a right-to-left override in the name", (item) => (item.name.en = "Example \u202Eetomer"), "name.en"],
  ["a zero width space in the description", (item) => (item.description["pt-BR"] = "Tipo\u200Bde exemplo."), "description.pt-BR"],
  ["an isolate in a field label", (_, m) => (m.fields = [{ key: "url", label: { en: "Address\u2066", "pt-BR": "Endereço" }, format: "url", required: false }]), "manifest.fields.0.label.en"],
  ["a control character in a field help", (_, m) => (m.fields = [{ key: "url", label: { en: "Address", "pt-BR": "Endereço" }, help: { en: "x", "pt-BR": "x\u0007" }, format: "url", required: false }]), "manifest.fields.0.help.pt-BR"],
  ["a right-to-left override in a field placeholder", (_, m) => (m.fields = [{ key: "team", label: { en: "Team", "pt-BR": "Time" }, placeholder: { en: "core", "pt-BR": "\u202Ecore" }, format: "text", required: false }]), "manifest.fields.0.placeholder.pt-BR"],
  ["a zero width space in a health check label", (_, m) => (m.healthCheck = [{ path: "/health", fields: [{ key: "version", label: { en: "Ver\u200Bsion", "pt-BR": "Vers\u00E3o" } }] }]), "manifest.healthCheck.0.fields.0.label.en"],
  ["a byte order mark in a scope", (_, m) => (m.methods[0].scopes = ["read", "\uFEFFwrite"]), "manifest.methods.0.scopes.1"],
  ["a right-to-left mark in a write tool", (_, m) => (m.writeTools = ["post\u200F_message"]), "manifest.writeTools.0"],
  ["an Arabic letter mark in a scope key description", (_, m) => (m.scopeKeys = [{ key: "example-remote.repo", normalize: "exact", description: { en: "Repo\u061C", "pt-BR": "Repo" } }]), "manifest.scopeKeys.0.description.en"],
  ["a word joiner in the name", (item) => (item.name["pt-BR"] = "Exemplo\u2060remoto"), "name.pt-BR"],
  ["a DEL in the description", (item) => (item.description.en = "Example\u007F"), "description.en"],
];

for (const [name, change, at] of hiddenText) {
  test(`a connection is refused with ${name}`, async () => {
    const errors = await validateFile(connection(change).file);
    const hit = errors.find((e) => e.field === at);
    assert.ok(hit, `expected an error at ${at}, got ${JSON.stringify(errors)}`);
    assert.match(hit.message, /invisible or control character U\+[0-9A-F]{4}/);
  });
}

test("text with an emoji joined by ZWJ, a ZWNJ, a soft hyphen, line breaks and tabs passes", async () => {
  const errors = await validateFile(connection((item, m) => {
    item.name.en = "Example \u{1F469}\u200D\u{1F4BB}";
    item.name["pt-BR"] = "Exem\u00ADplo re\u200Cmoto";
    item.description.en = "Example connection type.\n\tSecond line.";
    m.writeTools = ["post_message"];
  }).file);
  assert.deepEqual(errors, []);
});

test("a template and a package with hidden text in the name or description are refused", async () => {
  const template = await validateFile(variant((item) => (item.name.en = "Reply \u202Eylper")));
  assert.match(template.find((e) => e.field === "name.en")?.message ?? "", /U\+202E/);
  const pkg = await validateFile(variant((item) => {
    item.kind = "package";
    item.description["pt-BR"] = "Responde\u200B no canal.";
  }, "packages"));
  assert.match(pkg.find((e) => e.field === "description.pt-BR")?.message ?? "", /U\+200B/);
  assert.deepEqual(await validateFile(variant((item) => (item.name.en = "Reply \u{1F469}\u200D\u{1F4BB}"))), []);
});

test("a field marker before the path gets only the marker error, not one about a host nobody wrote", async () => {
  const errors = await validateFile(connection((item, m) => {
    item.minAppVersion = "0.1.170";
    m.fields = [{ key: "sub", label: { en: "Subdomain", "pt-BR": "Subdomínio" }, format: "url", required: true }];
    m.servers.remote.url = "https://${field:sub}.example.com/mcp";
  }).file);
  const atUrl = errors.filter((e) => e.field === "manifest.servers.remote.url");
  assert.equal(atUrl.length, 1, JSON.stringify(atUrl));
  assert.match(atUrl[0].message, /only in the path/);
});
