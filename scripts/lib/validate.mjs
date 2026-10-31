import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { OFFICIAL_CONNECTIONS, RESERVED_CONNECTION_IDS, TRIGGER_ANNOTATIONS, connectionClaims, itemRules, itemWarnings, officialClaims } from "./rules.mjs";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const schemasDir = fileURLToPath(new URL("../../schemas/", import.meta.url));

/** Catalog folders and the kind each one holds. */
export const FOLDERS = { connections: "connection", templates: "template", packages: "package" };
const SCHEMA_OF_KIND = { connection: "connection", template: "template", package: "package" };

let compiled;
async function schemas() {
  if (compiled !== undefined) return compiled;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  ajv.addVocabulary(TRIGGER_ANNOTATIONS);
  const byName = {};
  for (const name of ["envelope", "connection", "template", "package"]) {
    const schema = JSON.parse(await readFile(join(schemasDir, `${name}.schema.json`), "utf8"));
    ajv.addSchema(schema);
    byName[name] = schema.$id;
  }
  compiled = Object.fromEntries(Object.entries(byName).map(([name, id]) => [name, ajv.getSchema(id)]));
  return compiled;
}

function pointerToField(pointer) {
  return pointer
    .split("/")
    .slice(1)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

function schemaErrors(validate) {
  return (validate.errors ?? [])
    // A branch of oneOf that did not match says little; the oneOf error itself stays.
    .filter((e) => e.keyword !== "if" && !e.schemaPath.includes("/oneOf/"))
    .map((e) => {
      const at = pointerToField(e.instancePath);
      const join = (child) => (at === "" ? child : `${at}.${child}`);
      if (e.keyword === "required") return { field: join(e.params.missingProperty), message: `"${e.params.missingProperty}" is required` };
      if (e.keyword === "additionalProperties") return { field: join(e.params.additionalProperty), message: "unknown field" };
      if (e.keyword === "const") return { field: at, message: `must be ${JSON.stringify(e.params.allowedValue)}` };
      if (e.keyword === "oneOf" && at === "manifest.server") return { field: at, message: "needs exactly one of image or package" };
      if (at === "minAppVersion" && (e.keyword === "pattern" || e.keyword === "type")) return { field: at, message: "must be a version x.y.z, numbers only, like 0.2.0" };
      if (e.keyword === "enum") return { field: at, message: `must be one of ${e.params.allowedValues.map((v) => JSON.stringify(v)).join(", ")}` };
      return { field: at, message: e.message };
    });
}

/** What the path says the item is: the id from the file name and the kind from the folder, when it is a catalog folder. */
function expectedFromPath(file) {
  const folder = basename(dirname(file));
  return { id: basename(file).replace(/\.json$/, ""), folder, kind: FOLDERS[folder] };
}

/**
 * Parses and checks one file. Returns the item and its errors, each with file, field and message.
 * With `root`, the file is read as part of the catalog under it, where a local server is refused until the app pins
 * local servers (ADR 0018, slice 6), unless `localServers` is true. An official type may already run an image pinned
 * by digest, which the app builds the docker command for; a package still waits.
 */
export async function checkFile(file, { root, localServers = false } = {}) {
  const fail = (field, message, bytes) => ({ bytes, item: undefined, errors: [{ file, field, message }] });
  if (!(await lstat(file)).isFile()) return fail("", "catalog items must be regular files: symlinks and folders are refused");
  const bytes = await readFile(file);
  if (!file.endsWith(".json")) return fail("", "catalog items are .json files", bytes);
  let item;
  try {
    item = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return fail("", `not valid JSON: ${error.message}`, bytes);
  }
  const expected = expectedFromPath(file);
  const all = await schemas();
  const kind = typeof item?.kind === "string" && SCHEMA_OF_KIND[item.kind] !== undefined ? item.kind : undefined;
  const validate = all[kind === undefined ? "envelope" : SCHEMA_OF_KIND[kind]];
  validate(item);
  const ruled = itemRules(item, expected);
  const inCatalogConnections = root !== undefined && resolve(dirname(file)) === resolve(root, "connections");
  const local = item?.manifest?.servers?.local;
  if (inCatalogConnections && !localServers && local !== undefined) {
    if (!OFFICIAL_CONNECTIONS.has(item.id)) {
      ruled.push({ field: "manifest.servers.local", message: "local servers are not accepted yet: the app pins them in a later release, so only remote servers are published for now" });
    } else if (local?.package !== undefined) {
      ruled.push({ field: "manifest.servers.local", message: "a local server by package is not accepted yet: the app installs it pinned by the lockfile in a later release" });
    }
  }
  // A rule says more than the schema about the same field: keep the rule.
  const ruledFields = new Set(ruled.map((e) => e.field));
  const fromSchema = schemaErrors(validate).filter((e) => !ruledFields.has(e.field));
  const errors = [...ruled, ...fromSchema].map((e) => ({ file, ...e }));
  const warnings = itemWarnings(item).map((e) => ({ file, ...e }));
  return { bytes, item, errors, warnings };
}

export async function validateFile(file, options) {
  return (await checkFile(file, options)).errors;
}

/**
 * Every item in the catalog folders under root, with its bytes, and every error, ids unique across kinds and
 * what identifies a connection type claimed by one type only. `localServers: true` reads connections/ as it
 * will be once the app pins local servers.
 */
export async function validateCatalog(root, { localServers = false } = {}) {
  const items = [];
  const errors = [];
  const warnings = [];
  const owners = new Map();
  for (const folder of Object.keys(FOLDERS)) {
    let names = [];
    try {
      names = (await readdir(join(root, folder))).sort();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const name of names) {
      if (name === ".gitkeep") continue;
      const file = join(root, folder, name);
      const checked = await checkFile(file, { root, localServers });
      errors.push(...checked.errors);
      warnings.push(...(checked.warnings ?? []));
      if (checked.errors.length > 0) continue;
      const path = `${folder}/${name}`;
      const owner = owners.get(checked.item.id);
      if (owner !== undefined) {
        errors.push({ file, field: "id", message: `id "${checked.item.id}" is already used by ${owner}` });
        continue;
      }
      owners.set(checked.item.id, path);
      items.push({ kind: checked.item.kind, id: checked.item.id, path, bytes: checked.bytes, item: checked.item });
    }
  }
  const refused = identityErrors(items.filter((i) => i.kind === "connection"));
  errors.push(...refused.map(({ item, ...e }) => ({ file: join(root, item.path), ...e })));
  const out = new Set(refused.map((e) => e.item));
  return { items: items.filter((i) => !out.has(i)), errors, warnings };
}

/**
 * Each host, alias, package, tracker and action belongs to one connection type, and an alias is never the id of
 * another. A conflict between two items points to both files.
 */
function identityErrors(connections) {
  const owners = new Map(officialClaims().map((c) => [`${c.space}:${c.key}`, { id: c.owner }]));
  const ids = new Set([...OFFICIAL_CONNECTIONS.keys(), ...RESERVED_CONNECTION_IDS, ...connections.map((c) => c.id)]);
  const errors = [];
  for (const item of connections) {
    for (const claim of connectionClaims(item.item)) {
      const key = `${claim.space}:${claim.key}`;
      const owner = owners.get(key);
      if (owner !== undefined && owner.id !== item.id) {
        const where = owner.item === undefined ? "" : ` (${owner.item.path})`;
        errors.push({ item, field: claim.field, message: `${claim.space} "${claim.key}" is already claimed by ${owner.id}${where}` });
        if (owner.item !== undefined) {
          errors.push({ item: owner.item, field: owner.field, message: `${claim.space} "${claim.key}" is also claimed by ${item.id} (${item.path})` });
        }
      } else if (claim.space === "alias" && claim.key !== item.id && ids.has(claim.key)) {
        errors.push({ item, field: claim.field, message: `alias "${claim.key}" is the id of another type` });
      } else if (owner === undefined) {
        owners.set(key, { id: item.id, item, field: claim.field });
      }
    }
  }
  return errors;
}
