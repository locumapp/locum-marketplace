# locum-marketplace

[Português](README.pt-BR.md)

Public catalog for [Locum](https://locumapp.github.io): connection types,
automation templates and packages that anyone can propose.

## What lives here

- `connections/`: connection type manifests. Each manifest is data only: the
  MCP server with a pinned version (image with digest, or package with
  lockfile), the authentication methods, the instance fields and what the type
  writes outside the machine.
- `templates/`: automation templates, with every node visible.
- `packages/`: packages exported from Locum, already cleaned of company data.

Nothing here is code run by the app. A manifest that asks to run a downloaded
script is rejected.

User-facing text in every item (names, labels, descriptions) is localized:
each text field carries one entry per language (`en`, `pt-BR`), and the app
shows the one that matches the user's language.

## How the app uses it

The app only accepts an index signed by the maintainers of this repository
(Ed25519). An installed item stays pinned to the commit and hash it had, and
only changes when the user accepts an update. The install screen shows what
the item asks for: command or image, hosts, methods, scopes and write tools.

## How to propose an item

Open a PR with the file in the right folder. CI checks the schema and a
maintainer reviews it. The format of each folder is still being settled; until
then, open an issue describing what you want to publish.
