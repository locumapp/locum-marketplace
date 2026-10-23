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
  }
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
    m.hosts = ["githubcopilot.com"];
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
  const withPath = connection((_, m) => {
    m.fields = [urlField];
    m.methods = [{ type: "token", header: "Authorization" }, { type: "none" }];
    m.servers = { remote: { urlField: "url", path: "/api/mcp", headers: { Authorization: "Bearer ${credential}", "X-Origin": "${field:url}" } } };
    delete m.hosts;
  });
  assert.deepEqual(await validateFile(withPath.file), []);
  const inPath = connection((_, m) => {
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

test("an official type may take a free text field in the server that receives the credential", async () => {
  const { file } = connection((item, m) => {
    item.id = "grafana";
    m.fields = [urlField, textField("org")];
    m.servers.local.env = { GRAFANA_URL: "${field:url}", GRAFANA_ORG: "${field:org}", EXAMPLE_TOKEN: "${credential}" };
  }, "example-docker");
  assert.deepEqual(await validateFile(file), []);
});

test("in the catalog, an official type may run an image pinned by digest; a package or a community local server waits", async () => {
  const catalog = tempCatalog("connections");
  connection((item) => (item.id = "grafana"), "example-docker", catalog);
  connection((item) => (item.id = "prelo"), "example-npm", catalog);
  connection(() => {}, "example-docker", catalog);
  const { items, errors } = await validateCatalog(catalog);
  assert.deepEqual(items.map((i) => i.id), ["grafana"]);
  assert.deepEqual(errors.map((e) => [e.file.split("/").pop(), e.field]), [
    ["example-docker.json", "manifest.servers.local"],
    ["prelo.json", "manifest.servers.local"],
  ]);
  assert.match(errors[0].message, /not accepted yet/);
  assert.match(errors[1].message, /package/);
});

test("every official type that shipped in the app is published, and argocd, which never did, is not", async () => {
  const { items } = await validateCatalog(root);
  const official = JSON.parse(readFileSync(join(root, "scripts/lib/official-connections.json"), "utf8")).official;
  const published = items.filter((i) => i.kind === "connection").map((i) => i.id);
  assert.deepEqual(published, Object.keys(official).filter((id) => id !== "argocd").sort());
});

test("two connection types cannot claim the same host or alias, and the error points to both files", async () => {
  const { catalog } = connection((item, m) => {
    item.id = "example-a";
    m.aliases = ["shared-name"];
  });
  connection((item, m) => {
    item.id = "example-b";
    m.servers.remote.url = "https://other.example.com/mcp";
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
    m.aliases = ["ms365"];
    m.trackers = ["jira"];
  });
  const { errors } = await validateCatalog(catalog);
  const messages = errors.map((e) => `${e.field}: ${e.message}`);
  assert.ok(messages.some((m) => /^manifest\.servers\.remote\.url: host "mcp\.slack\.com" is already claimed by slack/.test(m)), messages.join("\n"));
  assert.ok(messages.some((m) => /^manifest\.aliases: alias "ms365" is already claimed by teams/.test(m)), messages.join("\n"));
  assert.ok(messages.some((m) => /^manifest\.trackers: tracker "jira" is already claimed by atlassian/.test(m)), messages.join("\n"));
});
