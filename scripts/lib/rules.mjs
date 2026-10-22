// The rules a JSON Schema cannot say: nothing here runs code, and local servers are pinned.
import { readFileSync } from "node:fs";

/**
 * Connection types that ship with the app (its `embutidos.json`), Argo CD, and the ids
 * the app reserves (`locum` for the core, `proprio` for servers registered by hand).
 * They are not published here (ADR 0012, decision 6).
 */
export const RESERVED_CONNECTION_IDS = new Set([
  "amplitude",
  "argocd",
  "asana",
  "atlassian",
  "canva",
  "figma",
  "github",
  "grafana",
  "intercom",
  "linear",
  "locum",
  "miro",
  "newrelic",
  "notion",
  "posthog",
  "prelo",
  "proprio",
  "sentry",
  "shortcut",
  "slack",
  "teams",
  "vercel",
]);

/** Runners that fetch and run a package on the spot, without a lockfile. */
const ONE_SHOT_RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx", "dlx"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "uv"]);
const SCRIPT_KEYS = new Set(["command", "script", "scripts", "preinstall", "install", "postinstall", "prepare", "setup", "entrypoint"]);
const PIPE_TO_SHELL = /\b(curl|wget|iwr|irm|invoke-webrequest)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\|\s*(iex|python3?|node|pwsh|powershell)\b/i;
const IMAGE_WITH_DIGEST = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/;
const INTEGRITY = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const CREDENTIAL = "${credential}";

/** Annotations the schema keeps on each trigger kind, read by the rules and the index. */
export const TRIGGER_ANNOTATIONS = ["x-reads-connection", "x-reads-server", "x-person-chooses"];

/** What each trigger kind reads and what the person picks on install, from `$defs.trigger` in the template schema. */
export const TRIGGER_KINDS = new Map(
  JSON.parse(readFileSync(new URL("../../schemas/template.schema.json", import.meta.url), "utf8")).$defs.trigger.allOf.map((branch) => [
    branch.if.properties.kind.const,
    { connection: branch.then["x-reads-connection"], serverField: branch.then["x-reads-server"], chooses: branch.then["x-person-chooses"] },
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
      errors.push({ field: "id", message: `"${item.id}" is a connection type built into the app and cannot be published here` });
    }
    if (isObject(item.manifest)) errors.push(...connectionRules(item.manifest));
  }
  if ((item.kind === "template" || item.kind === "package") && isObject(item.package)) {
    errors.push(...packageRules(item.package, item.kind));
  }
  return errors;
}

function connectionRules(manifest) {
  const errors = [];
  for (const path of scriptKeys(manifest, ["manifest"])) {
    if (path === "manifest.server.command") continue;
    errors.push({ field: path, message: "scripts and commands are not accepted: an item is data, and the app never runs code it downloads" });
  }
  const server = manifest.server;
  if (!isObject(server)) return errors;
  if (server.command !== undefined) errors.push(commandError(server));
  if (typeof server.image === "string" && !IMAGE_WITH_DIGEST.test(server.image)) {
    errors.push({ field: "manifest.server.image", message: `image must be pinned by digest (name@sha256:<64 hex>), found "${server.image}"` });
  }
  if (Array.isArray(server.args)) {
    server.args.forEach((arg, i) => {
      if (typeof arg !== "string") return;
      if (arg.includes(CREDENTIAL)) {
        errors.push({ field: field("manifest.server.args", i), message: `${CREDENTIAL} goes in env or a header, never in an argument (arguments show up in ps)` });
      }
      if (PIPE_TO_SHELL.test(arg)) errors.push({ field: field("manifest.server.args", i), message: "downloading and running a script is not accepted" });
    });
  }
  if (isObject(server.package)) errors.push(...lockfileRules(server.package));
  return errors;
}

function commandError(server) {
  const command = typeof server.command === "string" ? server.command.split("/").pop() : "";
  const args = Array.isArray(server.args) ? server.args : [];
  const oneShot = ONE_SHOT_RUNNERS.has(command) || (PACKAGE_MANAGERS.has(command) && args.some((a) => a === "exec" || a === "dlx" || a === "x" || a === "tool"));
  if (oneShot) {
    return {
      field: "manifest.server.command",
      message: `"${command}" fetches a package without a lockfile, which pins the version but not the dependencies; use server.package with an npm lockfile and integrity, or an image pinned by digest`,
    };
  }
  return {
    field: "manifest.server.command",
    message: "commands and scripts are not accepted: use an image pinned by digest or server.package with a lockfile",
  };
}

/** Paths of keys that ask to run something, anywhere in the manifest except the lockfile. */
function scriptKeys(value, path) {
  if (!isObject(value) && !Array.isArray(value)) return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const here = [...path, key];
    if (here.join(".") === "manifest.server.package.lockfile") continue;
    if (!Array.isArray(value) && SCRIPT_KEYS.has(key)) found.push(here.join("."));
    found.push(...scriptKeys(child, here));
  }
  return found;
}

function lockfileRules(pkg) {
  const errors = [];
  const base = "manifest.server.package.lockfile";
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
    errors.push({ field: "manifest.server.package.bin", message: `${pkg.name}@${pkg.version} has no bin "${pkg.bin}" in the lockfile` });
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
    if (typeof entry.resolved !== "string" || !entry.resolved.startsWith("https://")) {
      errors.push({ field: field(at, "resolved"), message: "every lockfile entry needs an https resolved URL" });
    }
    if (entry.hasInstallScript === true) {
      errors.push({ field: field(at, "hasInstallScript"), message: "a dependency with an install script runs code on install and is not accepted" });
    }
  }
  return errors;
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
  });
  return errors;
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
