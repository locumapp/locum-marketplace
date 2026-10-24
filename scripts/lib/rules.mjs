// The rules a JSON Schema cannot say: nothing here runs code, local servers are pinned, and a remote server is a public https host.
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const officialList = readJson("./official-connections.json");
const coreKinds = readJson("./core-kinds.json");

/** Tracker kinds and flow actions the app core has, from `core-kinds.json`. */
export const CORE_TRACKERS = new Set(coreKinds.trackers);
export const CORE_ACTIONS = new Set(coreKinds.actions);

/** Ids nobody publishes: `locum` for the core and `proprio` for servers registered by hand. */
export const RESERVED_CONNECTION_IDS = new Set(officialList.reserved);

/**
 * The official connection types, the ones that shipped inside the app (its `embutidos.json`) and Argo CD, with the
 * hosts, aliases, packages and trackers that identify them. Only the maintainer publishes them: CODEOWNERS covers their files
 * (ADR 0018, decision 4), and no other type may claim what identifies them.
 */
export const OFFICIAL_CONNECTIONS = new Map(Object.entries(officialList.official));

/** Each alias of an official type, with the type. The app matches a server name by id before alias, so no other id may take one. */
const OFFICIAL_ALIASES = new Map([...OFFICIAL_CONNECTIONS].flatMap(([id, o]) => (o.aliases ?? []).map((alias) => [alias, id])));

/** Runners that fetch and run a package on the spot, without a lockfile. */
const ONE_SHOT_RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx", "dlx"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "uv"]);
const SCRIPT_KEYS = new Set(["command", "script", "scripts", "preinstall", "install", "postinstall", "prepare", "setup", "entrypoint"]);
const PIPE_TO_SHELL = /\b(curl|wget|iwr|irm|invoke-webrequest)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\|\s*(iex|python3?|node|pwsh|powershell)\b/i;
const IMAGE_WITH_DIGEST = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/;
const INTEGRITY = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const NPM_REGISTRY = "https://registry.npmjs.org/";
const CREDENTIAL = "${credential}";
/** A marker in a value of the servers: `${credential}`, `${field:<key>}` or, refused, anything else. */
const MARKER = /\$\{([^}]*)\}/g;
const FIELD_MARKER = /^field:([a-z][a-zA-Z0-9]*)$/;
/** Where `${credential}` may go: a header of the remote server or the env of the local one. */
const CREDENTIAL_PLACES = /^manifest\.servers\.(remote\.headers|local\.env)\.[^.]+$/;
/**
 * Variables that change how a process loads code, which certificates it trusts or where its traffic goes, the docker
 * that runs the server (its env goes to docker too) and the ones the MCP client sets. The same list as the app.
 */
const RESERVED_ENV = /^(DOCKER_.*|HOME|LOGNAME|SHELL|TERM|USER|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_.*|DYLD_.*|ELECTRON_RUN_AS_NODE|NODE_TLS_REJECT_UNAUTHORIZED|SSLKEYLOGFILE|PATH|PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PERL5LIB|PERL5OPT|RUBYOPT|RUBYLIB|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|BASH_ENV|ENV|NPM_CONFIG_.*|GIT_.*|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i;
/** Container runtime flags that widen what the server reaches. The app puts args after the image; this is defense in depth. */
const CONTAINER_FLAGS = /^(--privileged|--cap-add|--pid|--ipc|--uts|--userns|--cgroupns|--network|--net|--device|--security-opt|--volume|--mount|--volumes-from)(=.*)?$|^-v($|[/.~]|[^:]*:)/;
/** Names that never resolve to a public host. */
const LOCAL_SUFFIXES = [".local", ".localhost", ".localdomain", ".internal", ".intranet", ".corp", ".private", ".home", ".home.arpa", ".lan", ".test", ".example", ".invalid"];
/** Methods whose reader takes a credential from another tool or a session on the machine: only official types use them. */
const MACHINE_METHODS = new Set(["cli", "session"]);

/**
 * The oldest app version a connection type may declare: the first one after 0.1.167, the last release that does not
 * install connection types. Goes up to the release of slice 2 of ADR 0018, with the published items in the same PR.
 */
export const CONNECTION_MIN_APP_VERSION = "0.1.168";

/** The first app version whose schema takes `servers.remote.path` and the `${field:<key>}` markers. */
export const MARKERS_MIN_APP_VERSION = "0.1.170";

/** The first app version with `batch` in a trigger (ADR 0019, slice 7a). */
export const BATCH_MIN_APP_VERSION = "0.1.175";

/** The first app version that creates held, with its whole config, a trigger missing a field in `x-pending-choice`. */
export const HELD_TRIGGER_MIN_APP_VERSION = "0.1.177";

/** A display name as the app compares it with the official ones: without accents or format characters, in lowercase. */
const normalizedName = (name) => name.normalize("NFKC").normalize("NFD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase().trim();

/** The display names of the official types and of the reserved `proprio`, which the app refuses in another type. */
const OFFICIAL_NAMES = new Map(
  [...Object.entries(officialList.official), ...Object.entries(officialList.reservedNames ?? {}).map(([id, names]) => [id, { names }])].flatMap(([id, o]) =>
    (o.names ?? []).map((name) => [normalizedName(name), id]),
  ),
);

const versionParts = (v) => v.split(".").map(Number);
/** Compares two x.y.z versions as numbers: negative, zero or positive. */
function compareVersions(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Annotations the schema keeps on each trigger kind and on the batch, read by the rules and the index. */
export const TRIGGER_ANNOTATIONS = ["x-reads-connection", "x-reads-server", "x-no-event", "x-person-chooses", "x-required-to-run", "x-pending-choice", "x-omitted-code", "x-held-by", "x-catch-all", "x-event-fields"];

const templateSchema = JSON.parse(readFileSync(new URL("../../schemas/template.schema.json", import.meta.url), "utf8"));

/** What the run of a batch reads in `{{event.*}}`, from `$defs.batch` in the template schema. */
const BATCH_EVENT_FIELDS = templateSchema.$defs.batch["x-event-fields"];

/** What each trigger kind reads and what the person picks on install, from `$defs.trigger` in the template schema. */
export const TRIGGER_KINDS = new Map(
  templateSchema.$defs.trigger.allOf.map((branch) => [
    branch.if.properties.kind.const,
    {
      connection: branch.then["x-reads-connection"],
      serverField: branch.then["x-reads-server"],
      noEvent: branch.then["x-no-event"] === true,
      takesBatch: branch.then.properties.batch !== undefined,
      chooses: branch.then["x-person-chooses"],
      requiredToRun: branch.then["x-required-to-run"] ?? [],
      pendingChoice: branch.then["x-pending-choice"] ?? [],
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
    } else if (OFFICIAL_ALIASES.has(item.id)) {
      errors.push({ field: "id", message: `"${item.id}" is an alias of the official type "${OFFICIAL_ALIASES.get(item.id)}": the app would match its servers to this id` });
    }
    if (typeof item.minAppVersion === "string" && /^\d+\.\d+\.\d+$/.test(item.minAppVersion)) {
      if (compareVersions(item.minAppVersion, CONNECTION_MIN_APP_VERSION) < 0) {
        errors.push({ field: "minAppVersion", message: `a connection type needs minAppVersion ${CONNECTION_MIN_APP_VERSION} or newer: older apps do not install connection types` });
      } else if (usesMarkers(item.manifest) && compareVersions(item.minAppVersion, MARKERS_MIN_APP_VERSION) < 0) {
        errors.push({ field: "minAppVersion", message: `servers.remote.path and \${field:<key>} need minAppVersion ${MARKERS_MIN_APP_VERSION} or newer: older apps refuse them` });
      }
    }
    if (isObject(item.name)) {
      for (const [language, name] of Object.entries(item.name)) {
        const official = typeof name === "string" ? OFFICIAL_NAMES.get(normalizedName(name)) : undefined;
        if (official !== undefined && official !== item.id) {
          errors.push({ field: field("name", language), message: `"${name}" is the name of the official type "${official}": the app ignores a type that takes it` });
        }
      }
    }
    if (isObject(item.manifest)) errors.push(...connectionRules(item.manifest, item.id));
  }
  const batched = item.kind === "template" && (Array.isArray(item.package?.automacao?.gatilhos) ? item.package.automacao.gatilhos : []).some((t) => isObject(t) && t.batch !== undefined);
  if (batched && (item.minAppVersion === undefined || (typeof item.minAppVersion === "string" && /^\d+\.\d+\.\d+$/.test(item.minAppVersion) && compareVersions(item.minAppVersion, BATCH_MIN_APP_VERSION) < 0))) {
    errors.push({ field: "minAppVersion", message: `batch needs minAppVersion ${BATCH_MIN_APP_VERSION} or newer: older apps run each event on its own and the batch fields come out empty` });
  }
  if (item.kind === "template" && (item.minAppVersion === undefined || (typeof item.minAppVersion === "string" && /^\d+\.\d+\.\d+$/.test(item.minAppVersion) && compareVersions(item.minAppVersion, HELD_TRIGGER_MIN_APP_VERSION) < 0))) {
    for (const { trigger, held } of heldBatches(item.package)) {
      errors.push({ field: "minAppVersion", message: `batch in a "${trigger.kind}" trigger without ${held.join(", ")} needs minAppVersion ${HELD_TRIGGER_MIN_APP_VERSION} or newer: older apps drop the whole trigger, batch included, until the person chooses` });
    }
  }
  if ((item.kind === "template" || item.kind === "package") && isObject(item.package)) {
    errors.push(...packageRules(item.package, item.kind));
  }
  return errors;
}

/** The batched triggers that leave out a field the app holds them for (`x-pending-choice`), with those fields. */
function heldBatches(pkg) {
  const triggers = Array.isArray(pkg?.automacao?.gatilhos) ? pkg.automacao.gatilhos : [];
  return triggers.flatMap((trigger) => {
    const reads = isObject(trigger) && trigger.batch !== undefined ? TRIGGER_KINDS.get(trigger.kind) : undefined;
    const held = reads === undefined ? [] : reads.pendingChoice.filter((f) => trigger[f] === undefined);
    return held.length === 0 ? [] : [{ trigger, held }];
  });
}

/** Whether the servers use what came into the app schema in 0.1.170: a path after urlField or a field marker. */
function usesMarkers(manifest) {
  const servers = isObject(manifest) ? manifest.servers : undefined;
  if (!isObject(servers)) return false;
  if (isObject(servers.remote) && servers.remote.path !== undefined) return true;
  return JSON.stringify([servers.remote?.url, servers.remote?.headers, servers.local?.args, servers.local?.env]).includes("${field:");
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
  errors.push(...markerRules(manifest));

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
    if (typeof method.env === "string" && RESERVED_ENV.test(method.env)) errors.push(loaderEnvError(field("manifest.methods", i, "env"), method.env));
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
    if (typeof action !== "string") return;
    if (!action.startsWith(`${id}.`)) {
      errors.push({ field: field("manifest.actions", i), message: `action must start with "${id}.", the type that owns it` });
    } else if (!CORE_ACTIONS.has(action)) {
      errors.push({ field: field("manifest.actions", i), message: `unknown action "${action}": the app core has ${[...CORE_ACTIONS].join(", ")}` });
    }
  });

  (Array.isArray(manifest.trackers) ? manifest.trackers : []).forEach((tracker, i) => {
    if (typeof tracker === "string" && !CORE_TRACKERS.has(tracker)) {
      errors.push({ field: field("manifest.trackers", i), message: `unknown tracker kind "${tracker}": the app core has ${[...CORE_TRACKERS].join(", ")}` });
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
  // A marker in the url has its own error from markerRules; a field in the path does not change the host.
  if (typeof server.url === "string" && markersOf(server.url).every((m) => m.kind === "field")) {
    errors.push(...urlRules(server.url.replace(MARKER, "x"), field(at, "url")));
  }
  if (typeof server.path === "string") {
    if (server.urlField === undefined) errors.push({ field: field(at, "path"), message: "path goes only with urlField: it is added to the address the person fills" });
    if (server.path.split("/").some((s) => s === "." || s === "..")) {
      errors.push({ field: field(at, "path"), message: "path takes no . or .. segment, which the url parser turns into another route" });
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
  return errors;
}

/** The markers of a value, in order. A `${` left open counts as an unknown marker. */
function markersOf(value) {
  const found = [];
  for (const m of value.matchAll(MARKER)) {
    const key = FIELD_MARKER.exec(m[1])?.[1];
    found.push({ kind: m[1] === "credential" ? "credential" : key !== undefined ? "field" : "unknown", key, text: m[0], index: m.index });
  }
  if (value.replace(MARKER, "").includes("${")) found.push({ kind: "unknown", text: "${", index: value.indexOf("${") });
  return found;
}

/** Where the path of an https url sits: from the first `/` after the host to the first `?` or `#`; empty without that `/`. */
function pathRegion(url) {
  const afterScheme = url.indexOf("://") + 3;
  const cut = url.slice(afterScheme).search(/[/?#]/);
  if (cut < 0 || url[afterScheme + cut] !== "/") return { start: url.length, end: url.length };
  const start = afterScheme + cut;
  const end = url.slice(start).search(/[?#]/);
  return { start, end: end < 0 ? url.length : start + end };
}

/**
 * The markers in the values of the servers, with the rules of the app (ADR 0018, "Marcadores nos valores"): only
 * `${credential}` and `${field:<key>}` of a declared field, the field only in the path of the url, the credential in one
 * place of each server and where the token method says. A free text field in the server that receives the credential is
 * refused in every type, as the app does with every type of the index: it could point the server to another host
 * without the origin check of a url.
 */
function markerRules(manifest) {
  const servers = manifest.servers;
  if (!isObject(servers)) return [];
  const errors = [];
  const fields = new Map((Array.isArray(manifest.fields) ? manifest.fields : []).filter(isObject).map((f) => [f.key, f]));
  const read = (at, value, region) => {
    const out = { credentials: 0, keys: [] };
    if (typeof value !== "string") return out;
    for (const m of markersOf(value)) {
      if (m.kind === "unknown") {
        errors.push({ field: at, message: `unknown placeholder ${m.text}; only ${CREDENTIAL} and \${field:<key>} are filled in` });
      } else if (m.kind === "credential") {
        out.credentials++;
      } else {
        out.keys.push(m.key);
        if (!fields.has(m.key)) errors.push({ field: at, message: `"${m.key}" is not a declared field` });
        if (region !== undefined && (m.index < region.start || m.index >= region.end)) {
          errors.push({ field: at, message: `\${field:${m.key}} goes only in the path of the url, after the host and before ? or #` });
        }
      }
    }
    return out;
  };
  const entries = (value) => (isObject(value) ? Object.entries(value) : []);
  const used = [];
  const { remote, local } = servers;
  if (isObject(remote)) {
    const at = "manifest.servers.remote";
    const keys = typeof remote.urlField === "string" ? [remote.urlField] : [];
    if (typeof remote.url === "string") keys.push(...read(field(at, "url"), remote.url, pathRegion(remote.url)).keys);
    let credentials = 0;
    for (const [name, value] of entries(remote.headers)) {
      const got = read(field(at, "headers", name), value);
      credentials += got.credentials;
      keys.push(...got.keys);
    }
    if (credentials > 1) errors.push({ field: field(at, "headers"), message: "the credential goes in one place of the server" });
    used.push({ at, http: true, slots: remote.headers, keys, credentials });
  }
  if (isObject(local)) {
    const at = "manifest.servers.local";
    const keys = [];
    (Array.isArray(local.args) ? local.args : []).forEach((arg, i) => keys.push(...read(field(at, "args", i), arg).keys));
    let credentials = 0;
    for (const [name, value] of entries(local.env)) {
      const got = read(field(at, "env", name), value);
      credentials += got.credentials;
      keys.push(...got.keys);
    }
    if (credentials > 1) errors.push({ field: field(at, "env"), message: "the credential goes in one place of the server" });
    used.push({ at, http: false, slots: local.env, keys, credentials });
  }

  const token = (Array.isArray(manifest.methods) ? manifest.methods : []).find((m) => isObject(m) && m.type === "token");
  for (const server of used) {
    const slot = entries(server.slots).find(([, v]) => typeof v === "string" && v.includes(CREDENTIAL))?.[0];
    if (token !== undefined && (typeof token.header === "string" || typeof token.env === "string")) {
      const declared = server.http ? token.header : token.env;
      const same = declared !== undefined && slot !== undefined && (server.http ? slot.toLowerCase() === declared.toLowerCase() : slot === declared);
      if (!same) {
        errors.push({
          field: "manifest.methods",
          message: `the token method puts the credential in "${declared ?? "another server"}", and the server takes it in "${slot ?? "no place"}"`,
        });
      }
    }
    if (server.credentials > 0) {
      for (const key of new Set(server.keys)) {
        if (fields.get(key)?.format === "text") {
          errors.push({
            field: server.at,
            message: `the field "${key}" is free text and goes into the server that receives the credential, where it could point the server to another host; use a url field`,
          });
        }
      }
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
  const written = writtenHost(value);
  if (written !== url.hostname || url.hostname.endsWith(".")) {
    return [{ field: at, message: `write the host in its canonical form, lowercase ASCII without a trailing dot: "${written}" is read as "${canonicalHost(url.hostname)}"` }];
  }
  const errors = [];
  if (url.username !== "" || url.password !== "") errors.push({ field: at, message: "the url must not carry a user or password; the credential goes in a header" });
  const why = notPublic(url.hostname);
  if (why !== undefined) errors.push({ field: at, message: `the server must be on a public host name, found ${why}` });
  return errors;
}

/** The host as written in the url, without user, port or path. */
function writtenHost(value) {
  const authority = value.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
  return authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
}

/** The host as the app compares it: lowercase ASCII (punycode), without a trailing dot. */
export function canonicalHost(host) {
  return new URL(`https://${host}/`).hostname.replace(/\.$/, "");
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
    for (const name of Object.keys(server.env)) if (RESERVED_ENV.test(name)) errors.push(loaderEnvError(field(at, "env", name), name));
  }
  if (isObject(server.package)) errors.push(...lockfileRules(server.package));
  return errors;
}

function loaderEnvError(at, name) {
  return {
    field: at,
    message: `${name} changes how the process loads code, what it trusts, where its traffic goes, the docker that runs the server or what the MCP client sets, and is not accepted`,
  };
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
  if (typeof url === "string" && URL.canParse(url)) claims.push({ space: "host", key: canonicalHost(new URL(url).hostname), field: "manifest.servers.remote.url" });
  for (const host of list(m.hosts)) if (URL.canParse(`https://${host}/`)) claims.push({ space: "host", key: canonicalHost(host), field: "manifest.hosts" });
  for (const alias of list(m.aliases)) claims.push({ space: "alias", key: alias, field: "manifest.aliases" });
  for (const pkg of list(m.packages)) claims.push({ space: "package", key: pkg, field: "manifest.packages" });
  const local = m.servers?.local?.package?.name;
  if (typeof local === "string" && !list(m.packages).includes(local)) claims.push({ space: "package", key: local, field: "manifest.servers.local.package.name" });
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
    if (trigger.batch !== undefined && !reads.takesBatch) {
      errors.push({ field: field(at, "batch"), message: `a "${trigger.kind}" trigger has no filter, so it has no batch either: the app joins only the events that pass a trigger filter` });
    } else if (trigger.batch !== undefined) {
      // A template holds the trigger from the app version it declares; a package declares none, so every app reads it.
      const held = kind === "template" ? reads.pendingChoice : [];
      const waiting = reads.requiredToRun.filter((f) => trigger[f] === undefined && !held.includes(f));
      if (waiting.length > 0) {
        errors.push({ field: field(at, "batch"), message: `a "${trigger.kind}" trigger without ${waiting.join(", ")} is not created on install: the app drops the whole trigger, batch included, until the person chooses, and the one they make by hand has no batch` });
      }
    }
    if (reads.takesBatch && Array.isArray(trigger.filter)) errors.push(...filterRules(trigger.filter, field(at, "filter")));
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
  const batched = [...new Set(triggers.filter((t) => isObject(t) && t.batch !== undefined && TRIGGER_KINDS.get(t.kind)?.takesBatch).map((t) => `"${t.kind}"`))];
  if (kind === "template" && batched.length > 0) {
    // A run of each reads a different event: the list of the batch or a single one.
    triggers.forEach((t, i) => {
      const reads = isObject(t) ? TRIGGER_KINDS.get(t.kind) : undefined;
      if (reads === undefined || reads.noEvent || t.batch !== undefined) return;
      const fix = reads.takesBatch ? "Batch all the triggers that bring an event, or none" : `A "${t.kind}" trigger takes no batch: remove it, or batch none`;
      errors.push({ field: field("package.automacao.gatilhos", i, "batch"), message: `a "${t.kind}" trigger brings a single event, and ${batched.join(", ")} ${batched.length === 1 ? "has" : "have"} batch: a run of each reads a different event, and no prompt serves both. ${fix}` });
    });
  }
  if (kind === "template" && batched.length > 0) {
    // The run of a batch gets the batch event, and a field of a single event renders as nothing.
    const single = (marker) => marker.split(".").length > 1 && !BATCH_EVENT_FIELDS.includes(marker.split(".")[1]);
    const steps = Array.isArray(pkg.automacao?.spec?.steps) ? pkg.automacao.spec.steps : [];
    steps.forEach((step, i) => {
      for (const { path, marker } of eventReads(step, field("package.automacao.spec.steps", i), single)) {
        errors.push({ field: path, message: `reads ${marker}, but ${batched.join(", ")} ${batched.length === 1 ? "has" : "have"} batch, and the batch event brings only ${BATCH_EVENT_FIELDS.join(", ")}: read each event inside {{event.items}}` });
      }
    });
  }
  return errors;
}

/** What the schema cannot say about a filter condition, checked as the app does (TriggerFilterCondition). */
function filterRules(filter, at) {
  const errors = [];
  filter.forEach((condition, j) => {
    const against = isObject(condition) ? condition.against : undefined;
    if (typeof against !== "string") return;
    const where = field(at, j, "against");
    // The app counts UTF-16 units (zod), the schema counts code points (ajv).
    if (against.length > 500) errors.push({ field: where, message: `${against.length} UTF-16 units, over the 500 the app takes` });
    const foreign = [...against.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]).find((m) => !/^\{\{\s*event\.[\w-]+(?:\.[\w-]+)*\s*\}\}$/.test(m));
    if (foreign !== undefined) {
      errors.push({ field: where, message: `${foreign}: against takes only event markers, like {{event.author.login}}; steps, memory and the others do not exist yet when the filter runs` });
    } else if (condition.compare === "matches" && !against.includes("{{") && !validRegex(against)) {
      errors.push({ field: where, message: "not a valid regular expression" });
    }
  });
  return errors;
}

function validRegex(value) {
  try {
    new RegExp(value, "i");
    return true;
  } catch {
    return false;
  }
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
const EVENT_MARKER = /\{\{\s*(event(?:\.[\w.]+)?)\s*\}\}/g;

/** Where a step reads the event, with the first marker of each field that `counts`, as the app names it. */
function eventReads(step, at, counts = () => true) {
  if (!isObject(step)) return [];
  return (RENDERED[step.type] ?? []).flatMap((key) => markers(step[key], field(at, key), counts));
}

function markers(value, path, counts) {
  if (typeof value === "string") {
    const found = [...value.matchAll(EVENT_MARKER)].map((m) => m[1]).find(counts);
    return found === undefined ? [] : [{ path, marker: `{{${found}}}` }];
  }
  if (!isObject(value) && !Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => markers(child, field(path, key), counts));
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
