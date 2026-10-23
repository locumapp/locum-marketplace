// The rules a JSON Schema cannot say: nothing here runs code, local servers are pinned, and a remote server is a public https host.
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

const officialList = JSON.parse(readFileSync(new URL("./official-connections.json", import.meta.url), "utf8"));

/** Ids nobody publishes: `locum` for the core and `proprio` for servers registered by hand. */
export const RESERVED_CONNECTION_IDS = new Set(officialList.reserved);

/**
 * The official connection types, the ones that shipped inside the app (its `embutidos.json`) and Argo CD, with the
 * hosts, aliases, packages and trackers that identify them. Only the maintainer publishes them: CODEOWNERS covers their files
 * (ADR 0018, decision 4), and no other type may claim what identifies them.
 */
export const OFFICIAL_CONNECTIONS = new Map(Object.entries(officialList.official));

/** Runners that fetch and run a package on the spot, without a lockfile. */
const ONE_SHOT_RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx", "dlx"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "uv"]);
const SCRIPT_KEYS = new Set(["command", "script", "scripts", "preinstall", "install", "postinstall", "prepare", "setup", "entrypoint"]);
const PIPE_TO_SHELL = /\b(curl|wget|iwr|irm|invoke-webrequest)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\|\s*(iex|python3?|node|pwsh|powershell)\b/i;
const IMAGE_WITH_DIGEST = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/;
const INTEGRITY = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const NPM_REGISTRY = "https://registry.npmjs.org/";
const CREDENTIAL = "${credential}";
const PLACEHOLDER = /\$\{[^}]*\}/g;
/** Where `${credential}` may go: a header of the remote server or the env of the local one. */
const CREDENTIAL_PLACES = /^manifest\.servers\.(remote\.headers|local\.env)\.[^.]+$/;
/** Variables that change how a process loads code, which certificates it trusts or where its traffic goes. */
const LOADER_ENV = /^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_.*|DYLD_.*|PATH|PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PERL5LIB|PERL5OPT|RUBYOPT|RUBYLIB|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|BASH_ENV|ENV|NPM_CONFIG_.*|GIT_.*|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i;
/** Container runtime flags that widen what the server reaches. The app puts args after the image; this is defense in depth. */
const CONTAINER_FLAGS = /^(--privileged|--cap-add|--pid|--ipc|--uts|--userns|--cgroupns|--network|--net|--device|--security-opt|--volume|--mount|--volumes-from|-v)(=.*)?$/;
/** Names that never resolve to a public host. */
const LOCAL_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa", ".lan"];
/** Methods whose reader takes a credential from another tool or a session on the machine: only official types use them. */
const MACHINE_METHODS = new Set(["cli", "session"]);

/** Annotations the schema keeps on each trigger kind, read by the rules and the index. */
export const TRIGGER_ANNOTATIONS = ["x-reads-connection", "x-reads-server", "x-no-event", "x-person-chooses", "x-required-to-run", "x-omitted-code", "x-held-by", "x-catch-all"];

/** What each trigger kind reads and what the person picks on install, from `$defs.trigger` in the template schema. */
export const TRIGGER_KINDS = new Map(
  JSON.parse(readFileSync(new URL("../../schemas/template.schema.json", import.meta.url), "utf8")).$defs.trigger.allOf.map((branch) => [
    branch.if.properties.kind.const,
    {
      connection: branch.then["x-reads-connection"],
      serverField: branch.then["x-reads-server"],
      noEvent: branch.then["x-no-event"] === true,
      chooses: branch.then["x-person-chooses"],
      requiredToRun: branch.then["x-required-to-run"] ?? [],
      catchAll: branch.then["x-catch-all"] ?? {},
      omittedCode: branch.then["x-omitted-code"] ?? {},
      heldBy: branch.then["x-held-by"] ?? {},
    },
  ]),
);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const field = (...parts) => parts.join(".");

/** Errors as `{ field, message }`, for an item already parsed. `expected` holds what the file path says. */
export function itemRules(item, expected) {
  const errors = [];
  if (!isObject(item)) return errors;
  if (typeof item.id === "string" && item.id !== expected.id) {
    errors.push({ field: "id", message: `id must match the file name: expected "${expected.id}", found "${item.id}"` });
  }
  if (expected.kind !== undefined && typeof item.kind === "string" && item.kind !== expected.kind) {
    errors.push({ field: "kind", message: `a "${item.kind}" item does not belong in ${expected.folder}/` });
  }
  if (item.kind === "connection") {
    if (RESERVED_CONNECTION_IDS.has(item.id)) {
      errors.push({ field: "id", message: `"${item.id}" is reserved by the app and cannot be published` });
    }
    if (isObject(item.manifest)) errors.push(...connectionRules(item.manifest, item.id));
  }
  if ((item.kind === "template" || item.kind === "package") && isObject(item.package)) {
    errors.push(...packageRules(item.package, item.kind));
  }
  return errors;
}

/** Why a host name is not public, or undefined when it is. IPv4 in any notation comes normalized by URL. */
function notPublic(host) {
  let name;
  try {
    name = new URL(`https://${host}/`).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch {
    return "not a host name";
  }
  if (isIP(name) !== 0) return "an IP address";
  if (name === "localhost" || LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return "a local name";
  if (!name.includes(".")) return "a single-label name";
  return undefined;
}

function connectionRules(manifest, id) {
  const errors = [];
  for (const path of scriptKeys(manifest, ["manifest"])) {
    if (path === "manifest.servers.local.command") continue;
    errors.push({ field: path, message: "scripts and commands are not accepted: an item is data, and the app never runs code it downloads" });
  }
  errors.push(...credentialPlacement(manifest));

  const methods = Array.isArray(manifest.methods) ? manifest.methods : [];
  const methodTypes = new Set();
  methods.forEach((method, i) => {
    if (!isObject(method)) return;
    if (methodTypes.has(method.type)) errors.push({ field: field("manifest.methods", i), message: `method "${method.type}" appears twice` });
    methodTypes.add(method.type);
    if (MACHINE_METHODS.has(method.type) && !OFFICIAL_CONNECTIONS.has(id)) {
      errors.push({
        field: field("manifest.methods", i),
        message: `the "${method.type}" method reads a credential from another tool or a session on the machine; only official connection types use it`,
      });
    }
    if (typeof method.env === "string" && LOADER_ENV.test(method.env)) errors.push(loaderEnvError(field("manifest.methods", i, "env"), method.env));
  });

  const fields = Array.isArray(manifest.fields) ? manifest.fields : [];
  const fieldKeys = new Set();
  fields.forEach((f, i) => {
    if (!isObject(f)) return;
    if (fieldKeys.has(f.key)) errors.push({ field: field("manifest.fields", i, "key"), message: `field "${f.key}" appears twice` });
    fieldKeys.add(f.key);
  });

  const scopeKeys = new Set();
  (Array.isArray(manifest.scopeKeys) ? manifest.scopeKeys : []).forEach((s, i) => {
    if (!isObject(s) || typeof s.key !== "string") return;
    if (!s.key.startsWith(`${id}.`)) errors.push({ field: field("manifest.scopeKeys", i, "key"), message: `scope key must start with "${id}."` });
    if (scopeKeys.has(s.key)) errors.push({ field: field("manifest.scopeKeys", i, "key"), message: `scope key "${s.key}" appears twice` });
    scopeKeys.add(s.key);
  });

  (Array.isArray(manifest.actions) ? manifest.actions : []).forEach((action, i) => {
    if (typeof action === "string" && !action.startsWith(`${id}.`)) {
      errors.push({ field: field("manifest.actions", i), message: `action must start with "${id}.", the type that owns it` });
    }
  });

  (Array.isArray(manifest.triggers) ? manifest.triggers : []).forEach((kind, i) => {
    const at = field("manifest.triggers", i);
    const spec = TRIGGER_KINDS.get(kind);
    if (spec === undefined) {
      errors.push({ field: at, message: `unknown trigger kind "${kind}": the app core has ${[...TRIGGER_KINDS.keys()].join(", ")}` });
    } else if (spec.connection !== undefined && spec.connection !== id) {
      errors.push({ field: at, message: `the "${kind}" trigger reads the "${spec.connection}" connection, not this one` });
    } else if (spec.connection === undefined && spec.serverField === undefined) {
      errors.push({ field: at, message: `the "${kind}" trigger reads no connection or server, so no connection type offers it` });
    }
  });

  (Array.isArray(manifest.hosts) ? manifest.hosts : []).forEach((host, i) => {
    const why = typeof host === "string" ? notPublic(host) : undefined;
    if (why !== undefined) errors.push({ field: field("manifest.hosts", i), message: `must be a public host name, found ${why}` });
  });

  const servers = manifest.servers;
  const triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];
  const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
  if (servers === undefined && triggers.length === 0 && actions.length === 0) {
    errors.push({ field: "manifest.servers", message: "a connection type needs servers, triggers or actions; without them it does nothing" });
  }
  if (!isObject(servers)) return errors;
  if (isObject(servers.remote)) errors.push(...remoteRules(servers.remote, fields));
  if (isObject(servers.local)) errors.push(...localRules(servers.local));
  return errors;
}

/** `${credential}` only where it goes to the server and nowhere it is logged: a header or the env of the local server. */
function credentialPlacement(manifest) {
  const errors = [];
  const walk = (value, path) => {
    if (path === "manifest.servers.local.package.lockfile") return;
    if (typeof value === "string") {
      if (!value.includes(CREDENTIAL) || CREDENTIAL_PLACES.test(path)) return;
      const message = path.startsWith("manifest.servers.local.args.")
        ? `${CREDENTIAL} goes in env or a header, never in an argument (arguments show up in ps)`
        : path === "manifest.servers.remote.url"
          ? `${CREDENTIAL} in the url ends up in logs; the credential goes in a header`
          : `${CREDENTIAL} goes only in a header of the remote server or in the env of the local server`;
      errors.push({ field: path, message });
      return;
    }
    if (isObject(value) || Array.isArray(value)) for (const [key, child] of Object.entries(value)) walk(child, field(path, key));
  };
  walk(manifest, "manifest");
  return errors;
}

function remoteRules(server, fields) {
  const errors = [];
  const at = "manifest.servers.remote";
  if (typeof server.url === "string" && !server.url.includes(CREDENTIAL)) {
    const placeholders = server.url.match(PLACEHOLDER);
    if (placeholders !== null) {
      errors.push({ field: field(at, "url"), message: `the url takes no placeholder (found ${placeholders.join(", ")}); an address per instance goes in urlField` });
    } else {
      errors.push(...urlRules(server.url, field(at, "url")));
    }
  }
  if (typeof server.urlField === "string") {
    const declared = fields.find((f) => isObject(f) && f.key === server.urlField);
    if (declared === undefined) {
      errors.push({ field: field(at, "urlField"), message: `"${server.urlField}" is not a declared field` });
    } else if (declared.format !== "url" || declared.required !== true) {
      errors.push({ field: field(at, "urlField"), message: `"${server.urlField}" must be a required url field` });
    }
  }
  if (isObject(server.headers)) {
    for (const [name, value] of Object.entries(server.headers)) {
      const others = typeof value === "string" ? (value.match(PLACEHOLDER) ?? []).filter((p) => p !== CREDENTIAL) : [];
      if (others.length > 0) errors.push({ field: field(at, "headers", name), message: `unknown placeholder ${others.join(", ")}; only ${CREDENTIAL} is filled in` });
    }
  }
  return errors;
}

function urlRules(value, at) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return [{ field: at, message: "not a valid url" }];
  }
  if (url.protocol !== "https:") return [{ field: at, message: "the server must be https" }];
  const errors = [];
  if (url.username !== "" || url.password !== "") errors.push({ field: at, message: "the url must not carry a user or password; the credential goes in a header" });
  const why = notPublic(url.hostname);
  if (why !== undefined) errors.push({ field: at, message: `the server must be on a public host name, found ${why}` });
  return errors;
}

function localRules(server) {
  const errors = [];
  const at = "manifest.servers.local";
  if (server.command !== undefined) errors.push(commandError(server));
  if (typeof server.image === "string") {
    if (!IMAGE_WITH_DIGEST.test(server.image)) {
      errors.push({ field: field(at, "image"), message: `image must be pinned by digest (name@sha256:<64 hex>), found "${server.image}"` });
    } else if (server.image.split("@")[0].split("/").pop().includes(":")) {
      errors.push({ field: field(at, "image"), message: "a tag next to the digest is not accepted: the digest is what runs, so the tag only misleads" });
    }
  }
  if (Array.isArray(server.args)) {
    server.args.forEach((arg, i) => {
      if (typeof arg !== "string") return;
      if (PIPE_TO_SHELL.test(arg)) errors.push({ field: field(at, "args", i), message: "downloading and running a script is not accepted" });
      if (server.image !== undefined && CONTAINER_FLAGS.test(arg)) {
        errors.push({ field: field(at, "args", i), message: `"${arg}" widens the container; args go to the server, and the app builds the run command` });
      }
    });
  }
  if (isObject(server.env)) {
    for (const name of Object.keys(server.env)) if (LOADER_ENV.test(name)) errors.push(loaderEnvError(field(at, "env", name), name));
  }
  if (isObject(server.package)) errors.push(...lockfileRules(server.package));
  return errors;
}

function loaderEnvError(at, name) {
  return { field: at, message: `${name} changes how the process loads code, what it trusts or where its traffic goes, and is not accepted` };
}

function commandError(server) {
  const command = typeof server.command === "string" ? server.command.split("/").pop() : "";
  const args = Array.isArray(server.args) ? server.args : [];
  const oneShot = ONE_SHOT_RUNNERS.has(command) || (PACKAGE_MANAGERS.has(command) && args.some((a) => a === "exec" || a === "dlx" || a === "x" || a === "tool"));
  if (oneShot) {
    return {
      field: "manifest.servers.local.command",
      message: `"${command}" fetches a package without a lockfile, which pins the version but not the dependencies; use servers.local.package with an npm lockfile and integrity, or an image pinned by digest`,
    };
  }
  return {
    field: "manifest.servers.local.command",
    message: "commands and scripts are not accepted: use an image pinned by digest or servers.local.package with a lockfile",
  };
}

/** Paths of keys that ask to run something, anywhere in the manifest except the lockfile. */
function scriptKeys(value, path) {
  if (!isObject(value) && !Array.isArray(value)) return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const here = [...path, key];
    if (here.join(".") === "manifest.servers.local.package.lockfile") continue;
    if (!Array.isArray(value) && SCRIPT_KEYS.has(key)) found.push(here.join("."));
    found.push(...scriptKeys(child, here));
  }
  return found;
}

function lockfileRules(pkg) {
  const errors = [];
  const base = "manifest.servers.local.package.lockfile";
  const lock = pkg.lockfile;
  if (!isObject(lock) || !isObject(lock.packages)) return errors;
  const root = lock.packages[""];
  if (!isObject(root) || !isObject(root.dependencies) || root.dependencies[pkg.name] !== pkg.version) {
    errors.push({ field: field(base, "packages"), message: `the lockfile root must depend on ${pkg.name} at exactly ${pkg.version}` });
  } else {
    const others = [
      ...Object.keys(root.dependencies).filter((name) => name !== pkg.name),
      ...["devDependencies", "optionalDependencies", "peerDependencies"].flatMap((group) => (isObject(root[group]) ? Object.keys(root[group]) : [])),
    ];
    if (others.length > 0) {
      errors.push({ field: field(base, "packages"), message: `the lockfile root must depend only on ${pkg.name}, found also ${others.sort().join(", ")}` });
    }
  }
  const main = lock.packages[`node_modules/${pkg.name}`];
  if (!isObject(main) || main.version !== pkg.version) {
    errors.push({ field: field(base, "packages"), message: `the lockfile must resolve ${pkg.name} to ${pkg.version}` });
  } else if (pkg.bin !== undefined && !(isObject(main.bin) && typeof main.bin[pkg.bin] === "string")) {
    errors.push({ field: "manifest.servers.local.package.bin", message: `${pkg.name}@${pkg.version} has no bin "${pkg.bin}" in the lockfile` });
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    const at = field(base, "packages", key);
    if (!isObject(entry)) {
      errors.push({ field: at, message: "lockfile entry must be an object" });
      continue;
    }
    if (entry.link === true) {
      errors.push({ field: field(at, "link"), message: "linked local folders are not accepted" });
      continue;
    }
    if (typeof entry.integrity !== "string" || !INTEGRITY.test(entry.integrity)) {
      errors.push({ field: field(at, "integrity"), message: "every lockfile entry needs an integrity hash (sha512-...)" });
    }
    if (typeof entry.resolved !== "string" || !entry.resolved.startsWith(NPM_REGISTRY)) {
      errors.push({ field: field(at, "resolved"), message: `every lockfile entry must resolve from ${NPM_REGISTRY}` });
    }
    // Only the honest case: a lockfile can leave the flag out, so the app also installs with --ignore-scripts.
    if (entry.hasInstallScript === true) {
      errors.push({ field: field(at, "hasInstallScript"), message: "a dependency with an install script runs code on install and is not accepted" });
    }
  }
  return errors;
}

/**
 * What identifies each connection type in the catalog: the host of its remote server and its hosts, aliases,
 * packages, trackers and actions. Each one belongs to one type, so a server never matches two.
 */
export function connectionClaims(item) {
  const m = isObject(item.manifest) ? item.manifest : {};
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  const claims = [];
  const url = m.servers?.remote?.url;
  if (typeof url === "string" && URL.canParse(url)) claims.push({ space: "host", key: new URL(url).hostname, field: "manifest.servers.remote.url" });
  for (const host of list(m.hosts)) claims.push({ space: "host", key: host, field: "manifest.hosts" });
  for (const alias of list(m.aliases)) claims.push({ space: "alias", key: alias, field: "manifest.aliases" });
  for (const pkg of list(m.packages)) claims.push({ space: "package", key: pkg, field: "manifest.packages" });
  for (const tracker of list(m.trackers)) claims.push({ space: "tracker", key: tracker, field: "manifest.trackers" });
  for (const action of list(m.actions)) claims.push({ space: "action", key: action, field: "manifest.actions" });
  return claims;
}

/** The claims of the official types, from the list, for a catalog that has not published them yet. */
export function officialClaims() {
  return [...OFFICIAL_CONNECTIONS].flatMap(([id, o]) =>
    connectionClaims({ manifest: { hosts: o.hosts, aliases: o.aliases, packages: o.packages, trackers: o.trackers } }).map((c) => ({ ...c, owner: id })),
  );
}


/**
 * What the import checks beyond the schema: agent ids, the agent a step uses, step keys and needs, and version 4 features.
 * Also what the install needs: a template has a trigger, and what each trigger reads is in the requirements.
 */
function packageRules(pkg, kind) {
  const errors = [];
  const agents = Array.isArray(pkg.agents) ? pkg.agents : [];
  const agentIds = new Set();
  agents.forEach((agent, i) => {
    if (!isObject(agent)) return;
    if (agentIds.has(agent.id)) errors.push({ field: field("package.agents", i, "id"), message: `agent "${agent.id}" appears twice` });
    agentIds.add(agent.id);
  });
  const steps = Array.isArray(pkg.automacao?.spec?.steps) ? pkg.automacao.spec.steps : [];
  const keys = new Set();
  steps.forEach((step, i) => {
    if (!isObject(step)) return;
    if (keys.has(step.key)) errors.push({ field: field("package.automacao.spec.steps", i, "key"), message: `step key "${step.key}" appears twice` });
    keys.add(step.key);
  });
  steps.forEach((step, i) => {
    if (!isObject(step)) return;
    const at = field("package.automacao.spec.steps", i);
    if (step.type === "model" && step.profile !== undefined && !agentIds.has(step.profile)) {
      errors.push({ field: field(at, "profile"), message: `step "${step.key}" uses agent "${step.profile}", which is not in the package` });
    }
    (Array.isArray(step.needs) ? step.needs : []).forEach((need, j) => {
      if (!keys.has(need)) errors.push({ field: field(at, "needs", j), message: `step "${step.key}" needs "${need}", which is not a step` });
    });
    if (typeof pkg.versao === "number" && pkg.versao < 4 && step.type === "model" && step.memory !== undefined) {
      errors.push({ field: field(at, "memory"), message: "memory in a step needs version 4 of the package format" });
    }
  });
  const cycle = needsCycle(steps);
  if (cycle !== undefined) errors.push({ field: "package.automacao.spec.steps", message: `the steps needs form a cycle: ${cycle.join(" -> ")}` });
  if (typeof pkg.versao === "number" && pkg.versao < 4 && pkg.notas !== undefined) {
    errors.push({ field: "package.notas", message: "memory notes need version 4 of the package format" });
  }
  errors.push(...triggerRules(pkg, kind));
  return errors;
}

function triggerRules(pkg, kind) {
  const errors = [];
  const triggers = Array.isArray(pkg.automacao?.gatilhos) ? pkg.automacao.gatilhos : [];
  if (kind === "template" && triggers.length === 0) {
    errors.push({ field: "package.automacao.gatilhos", message: "a template needs at least one trigger, assembled and visible, for the install to fill in" });
  }
  const names = (list, key) => new Set((Array.isArray(list) ? list : []).filter(isObject).map((entry) => entry[key]));
  const connections = names(pkg.requisitos?.conexoes, "id");
  const servers = names(pkg.requisitos?.servidores, "nome");
  triggers.forEach((trigger, i) => {
    const reads = isObject(trigger) ? TRIGGER_KINDS.get(trigger.kind) : undefined;
    if (reads === undefined) return;
    const at = field("package.automacao.gatilhos", i);
    if (reads.connection !== undefined && !connections.has(reads.connection)) {
      errors.push({ field: field(at, "kind"), message: `a "${trigger.kind}" trigger reads the "${reads.connection}" connection, which is not in package.requisitos.conexoes` });
    }
    const server = reads.serverField === undefined ? undefined : trigger[reads.serverField];
    if (typeof server === "string" && !servers.has(server)) {
      errors.push({ field: field(at, reads.serverField), message: `a "${trigger.kind}" trigger reads the server "${server}", which is not in package.requisitos.servidores` });
    }
    if (kind === "template") errors.push(...leftOutRules(pkg, trigger, i, reads));
  });
  const silent = [...new Set(triggers.filter((t) => isObject(t) && TRIGGER_KINDS.get(t.kind)?.noEvent).map((t) => `"${t.kind}"`))];
  if (kind === "template" && silent.length > 0) {
    // A run from any of these has no event, and the app renders the marker as nothing.
    const steps = Array.isArray(pkg.automacao?.spec?.steps) ? pkg.automacao.spec.steps : [];
    steps.forEach((step, i) => {
      for (const { path, marker } of eventReads(step, field("package.automacao.spec.steps", i))) {
        errors.push({ field: path, message: `reads ${marker}, but ${silent.join(", ")} ${silent.length === 1 ? "brings" : "bring"} no event: fetch with the step tools instead` });
      }
    });
  }
  return errors;
}

/** A template leaves what the person chooses out in the way its kind says, so the install asks for it. */
function leftOutRules(pkg, trigger, i, reads) {
  const errors = [];
  const at = field("package.automacao.gatilhos", i);
  const omitted = (Array.isArray(pkg.omitidos) ? pkg.omitidos : []).filter((o) => isObject(o) && (o.onde === `gatilho:${i}` || o.onde === trigger.kind));
  for (const f of reads.chooses) {
    const value = trigger[f];
    const catchAll = value !== undefined && (reads.catchAll[f] ?? []).includes(value);
    if (value !== undefined && !catchAll) continue;
    if (catchAll && reads.requiredToRun.includes(f)) {
      errors.push({ field: field(at, f), message: `${f} "${value}" matches everything: leave it out so the person chooses on install` });
    }
    const code = reads.omittedCode[f];
    // A code that names its fields (argumentos) needs the field in params; the others reach the field through the app marking.
    if (code !== undefined && !omitted.some((o) => o.codigo === code && (Array.isArray(o.params) ? o.params.includes(f) : code !== "argumentos"))) {
      const params = code === "argumentos" ? `, "params": ["${f}"]` : "";
      errors.push({ field: field(at, f), message: `the person chooses ${f} on install: add { "codigo": "${code}", "onde": "gatilho:${i}"${params} } to package.omitidos` });
    }
    const holder = reads.heldBy[f];
    if (holder !== undefined && trigger[holder] === undefined) {
      errors.push({ field: field(at, holder), message: `the person chooses the ${f} on install: set ${holder} so the app holds the trigger until they do` });
    }
  }
  return errors;
}

/** What the app renders with the event, by step type (`camposRenderizados` in the app executor); name, key and the rest are not. */
const RENDERED = { model: ["prompt"], action: ["params"], logic: ["value", "against", "title"] };
const EVENT_MARKER = /\{\{\s*(event(?:\.[\w.]+)?)\s*\}\}/;

/** Where a step reads the event, with the marker as the app names it. */
function eventReads(step, at) {
  if (!isObject(step)) return [];
  return (RENDERED[step.type] ?? []).flatMap((key) => markers(step[key], field(at, key)));
}

function markers(value, path) {
  if (typeof value === "string") {
    const found = EVENT_MARKER.exec(value);
    return found === null ? [] : [{ path, marker: `{{${found[1]}}}` }];
  }
  if (!isObject(value) && !Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => markers(child, field(path, key)));
}

/** The first cycle in the needs between steps, as a list of keys that starts and ends on the same step. */
function needsCycle(steps) {
  const needs = new Map();
  for (const step of steps) {
    if (isObject(step) && typeof step.key === "string") needs.set(step.key, Array.isArray(step.needs) ? step.needs : []);
  }
  const state = new Map();
  const path = [];
  const visit = (key) => {
    if (state.get(key) === "done" || !needs.has(key)) return undefined;
    if (state.get(key) === "open") return [...path.slice(path.indexOf(key)), key];
    state.set(key, "open");
    path.push(key);
    for (const need of needs.get(key)) {
      const found = visit(need);
      if (found !== undefined) return found;
    }
    path.pop();
    state.set(key, "done");
    return undefined;
  };
  for (const key of needs.keys()) {
    const found = visit(key);
    if (found !== undefined) return found;
  }
  return undefined;
}
