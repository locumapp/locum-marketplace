# Contributing

[Português](CONTRIBUTING.pt-BR.md)

Anyone can propose a template or a package. Open a PR that adds or changes one
file; CI validates it and a maintainer reviews it. Connection types are not
accepted yet: the format is below so it can be discussed, but the validator
refuses files in `connections/` until the app opens them (see
[docs/connections-pending.md](docs/connections-pending.md)).

## Run the validator

Node 20 or newer:

```sh
npm ci --ignore-scripts
npm run validate                                  # the whole catalog
node scripts/validate.mjs templates/my-item.json  # one file
npm test
```

Each error says the file and the field, like
`templates/my-item.json: name.pt-BR: "pt-BR" is required`.

Maintainers keep a list of forbidden terms (company, team and people names)
outside the repository, in `~/.config/locum/termos-proibidos` or the path in
`LOCUM_TERMOS_PROIBIDOS`. When the list exists, `npm run validate` fails on any
tracked file that holds one of them; without it, it warns and goes on.

## The envelope

Every item is `<folder>/<id>.json`:

| field | |
| :--- | :--- |
| `kind` | `connection` in `connections/`, `template` in `templates/`, `package` in `packages/` |
| `id` | kebab-case, equal to the file name, unique in the whole catalog |
| `version` | integer, starts at 1 and goes up on every change; CI checks it against the base of the PR |
| `name`, `description` | `{"en": "...", "pt-BR": "..."}`, both languages required |
| `tags` | optional, kebab-case |
| `minAppVersion` | template only, optional: the oldest Locum version that installs it, `x.y.z`; see the README for when to declare it |
| `manifest` or `package` | the body, below |

The schemas are in [`schemas/`](schemas/): `envelope.schema.json` and one per
kind.

## Connection types (not accepted yet)

`manifest` describes the type as data:

- `category`, `logo` (or `null`), `color` (hex without `#`);
- `methods`: `oauth` (optional `scopes`), `token` (optional `header` or `env`
  that carries the credential) or `none`;
- `fields`: what an instance asks for besides its name, such as an address;
- `server`, one of:
  - `{"transport": "http", "url": "https://..."}`, optional `headers`;
  - `{"transport": "stdio", "image": "registry/name@sha256:<64 hex>"}`;
  - `{"transport": "stdio", "package": {"registry": "npm", "name", "version", "bin", "lockfile"}}`,
    where `lockfile` is the `package-lock.json` (version 2 or 3) of a project
    whose only dependency is `name@version`. Every entry needs `integrity` and
    an https `resolved`, and no entry may have an install script.
  - `args` and `env` are optional on stdio. `${credential}` goes in `env` or a
    header, never in `args`.
- `writeTools`: the server tools that write outside the machine;
- `hosts`, `aliases`, `packages` and `scopeKeys`, as in the app manifests.

Not accepted: `command`, `npx`, `uvx` or any other way of running a script;
an image without digest; and the ids of types built into the app (`github`,
`slack`, `teams`, `grafana`, `prelo`, `argocd` and the others in
[`scripts/lib/rules.mjs`](scripts/lib/rules.mjs)).

## Templates and packages

`package` is a Locum package, the same file the app exports and imports
(`formato: "locum-pacote"`, `versao` 1 to 4). A template is a package with
the automation assembled and every node visible; a package is what someone
exported from Locum. Export it from the app, so it comes out already cleaned,
and paste it under `package`.

A template brings at least one trigger in `automacao.gatilhos`, without what
belongs to the person: owner, repositories, channels, chats. The app asks for
those on install. `$defs.trigger` in `schemas/template.schema.json` says, for
each kind, what the person chooses (`x-person-chooses`) and how the template
leaves each field out: the app needs it to create the trigger
(`x-required-to-run`, nothing to add), an entry in `omitidos` with the code in
`x-omitted-code` and `onde: "gatilho:<position>"` (for `argumentos`, with the
field in `params`), or the field in `x-held-by` set, which holds the trigger
until the person chooses (`chatsRestritos` in `teams-inbox`). No template
watches every repository or every chat by leaving the field empty, and a
value that takes everything (`x-catch-all`, like `repoMatch: ".*"`) counts as
not chosen.

Known limit: `myUserId` in `slack-inbox` is only needed when Slack is read
through an MCP server and not the official connection. The schema cannot say
that, so every template with `slack-inbox` leaves it to choose.

Whatever a trigger reads must be in `requisitos`: the connection of its kind
(`x-reads-connection`) in `conexoes`, and the `server` of an `mcp-poll` in
`servidores`. A template can only read `{{event.*}}` what some trigger
delivers, in the fields the app renders (the prompt, the action `params`, and
`value`, `against` and `title` of a logic step). `cron`, `schedule` and
`webhook` bring no event (`x-no-event`), and a run started by one of them has
none, even when another trigger of the template brings one: a template with
any of them fetches with the tools of its steps. A template that would need an
event no trigger delivers stays out of the catalog until the app has that
trigger. A package may come without a trigger.

Before opening the PR, check that no company data is left: names of people,
teams, channels, hosts and repositories must be generic.
