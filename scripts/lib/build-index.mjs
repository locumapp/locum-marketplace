import { createHash } from "node:crypto";
import { relative } from "node:path";
import { OFFICIAL_CONNECTIONS, TRIGGER_KINDS, canonicalHost } from "./rules.mjs";
import { validateCatalog } from "./validate.mjs";

export const INDEX_FORMAT = "locum-marketplace-index";
export const INDEX_VERSION = 1;
const KIND_ORDER = ["connection", "template", "package"];
const FULL_SHA = /^[0-9a-f]{40}$/;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values) => [...new Set(values)].sort(byCodeUnit);

function connectionRequires(manifest) {
  const { remote, local } = manifest.servers ?? {};
  const servers = {};
  if (remote !== undefined) servers.remote = remote.url !== undefined ? { url: remote.url } : { urlField: remote.urlField };
  if (local !== undefined) servers.local = local.image !== undefined ? { image: local.image } : { package: `${local.package.name}@${local.package.version}` };
  return {
    servers,
    hosts: sorted([...(remote?.url !== undefined ? [new URL(remote.url).hostname] : []), ...(manifest.hosts ?? [])].map(canonicalHost)),
    methods: manifest.methods.map((m) => (m.reader === undefined ? { type: m.type } : { type: m.type, reader: m.reader })),
    scopes: sorted(manifest.methods.flatMap((m) => m.scopes ?? [])),
    fields: (manifest.fields ?? []).map((f) => f.key),
    triggers: sorted(manifest.triggers ?? []),
    actions: sorted(manifest.actions ?? []),
    writeTools: sorted(manifest.writeTools ?? []),
  };
}

function packageRequires(pkg) {
  const req = pkg.requisitos;
  return {
    connections: sorted(req.conexoes.map((c) => c.id)),
    servers: sorted(req.servidores.map((s) => s.nome)),
    providers: [...req.provedores]
      .sort((a, b) => byCodeUnit(a.provedor, b.provedor))
      .map((p) => ({ provider: p.provedor, models: sorted(p.modelos) })),
    skills: sorted((req.skills ?? []).map((s) => s.nome)),
    actions: sorted(pkg.automacao.spec.steps.filter((s) => s.type === "action").map((s) => s.action)),
    // In the package order: what the person picks is what the kind leaves to them and the trigger does not bring.
    triggers: pkg.automacao.gatilhos.map((g) => ({ kind: g.kind, choose: TRIGGER_KINDS.get(g.kind).chooses.filter((f) => g[f] === undefined) })),
  };
}

/**
 * The bytes of index.json for the catalog under root at the given commit. `committedAt` is the
 * commit time in seconds: it orders indexes without a date that changes on every build, so the
 * same catalog and commit give the same bytes.
 */
export async function buildIndex(root, { commit, committedAt, localServers = false }) {
  if (typeof commit !== "string" || !FULL_SHA.test(commit)) throw new Error(`commit must be a full 40-character sha, found "${commit}"`);
  if (!Number.isSafeInteger(committedAt) || committedAt < 0) throw new Error(`committedAt must be the commit time in seconds, found "${committedAt}"`);
  const { items, errors } = await validateCatalog(root, { localServers });
  if (errors.length > 0) {
    throw new Error(`the catalog is invalid:\n${errors.map((e) => `${relative(root, e.file)}: ${e.field}: ${e.message}`).join("\n")}`);
  }
  const entries = items
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byCodeUnit(a.id, b.id))
    .map(({ kind, id, path, bytes, item }) => ({
      kind,
      id,
      version: item.version,
      // Only when declared: an item without it keeps the bytes it had in the index.
      ...(item.minAppVersion !== undefined ? { minAppVersion: item.minAppVersion } : {}),
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      name: item.name,
      description: item.description,
      tags: item.tags ?? [],
      requires: kind === "connection" ? connectionRequires(item.manifest) : packageRequires(item.package),
      // The mark comes from the maintainers' list, never from the item file; the app trusts it because the index is signed.
      ...(kind === "connection" && OFFICIAL_CONNECTIONS.has(id) ? { official: true } : {}),
    }));
  const index = { format: INDEX_FORMAT, version: INDEX_VERSION, commit, committedAt, items: entries };
  return `${JSON.stringify(index, null, 2)}\n`;
}
