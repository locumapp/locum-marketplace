# locum-marketplace

[Português](README.pt-BR.md)

Public catalog for [Locum](https://locumapp.github.io): connection types,
automation templates and packages that anyone can propose.

## What lives here

- `connections/`: connection type manifests. Each manifest is data only: the
  MCP server (a remote https endpoint, an image pinned by digest, or an npm
  package pinned by its lockfile), the authentication methods, the instance
  fields and the tools that write outside the machine. Not accepted yet: the
  validator refuses files here until the app opens connection types, and
  [docs/connections-pending.md](docs/connections-pending.md) lists what must
  be closed first.
- `templates/`: automation templates, with every node visible.
- `packages/`: packages exported from Locum, already cleaned of company data.

Each item is one JSON file, `<folder>/<id>.json`, with a shared envelope:
`kind`, `id`, `version`, `name`, `description`, optional `tags`, and the body
(`manifest` for a connection, `package` for a template or a package). The
schemas are in [`schemas/`](schemas/), and [CONTRIBUTING.md](CONTRIBUTING.md)
explains each field.

Nothing here is code run by the app. An item that asks to run a command or a
downloaded script is rejected. `npx` and `uvx` are never accepted: a local
server is an image pinned by digest or an npm package pinned by its lockfile.

User-facing text in every item (names, labels, descriptions) is localized:
each text field carries one entry per language (`en`, `pt-BR`), and the app
shows the one that matches the user's language.

## How the app uses it

CI publishes `index.json` and its Ed25519 signature, `index.json.sig`, to the
`index` branch on every push to `main`:

- index: `https://raw.githubusercontent.com/locumapp/locum-marketplace/index/index.json`
- item: `https://raw.githubusercontent.com/locumapp/locum-marketplace/<commit>/<path>`

The index lists every item with the commit it was built from, the commit time
(`committedAt`, in seconds), the sha256 of the file and what the item asks
for. The app will keep a list of trusted public keys and accept only an index
signed by one of them. Today the list has one key (SPKI DER, base64, also in
[`keys/index-signing.pub`](keys/index-signing.pub)):

```
MCowBQYDK2VwAyEAkZEZ6pKsyVb9KBFvI56NOo6nsaldB4j3cS/ds9Y/shM=
```

The app will refuse an index whose `committedAt` is older than the one it
already has, so an old signed index cannot be served again. An installed item
will stay pinned to the commit and hash it had, and only change when the user
accepts an update. The install screen will show what the item asks for:
server or image, hosts, methods, scopes and write tools for a connection;
connections, servers, providers and actions for a template or a package.

## How to propose an item

Open a PR with the file in the right folder. CI runs the validator and a
maintainer reviews it. See [CONTRIBUTING.md](CONTRIBUTING.md).
