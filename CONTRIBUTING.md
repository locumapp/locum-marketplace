# Contributing

[Português](CONTRIBUTING.pt-BR.md)

Anyone can propose a connection type, a template or a package. Open a PR that
adds or changes one file; CI validates it and a maintainer reviews it.

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
| `minAppVersion` | the oldest Locum version that installs the item, `x.y.z`: required in a connection, optional in a template; see the README for when to declare it |
| `manifest` or `package` | the body, below |

The schemas are in [`schemas/`](schemas/): `envelope.schema.json` and one per
kind.

## Connection types

Every connection Locum knows comes from this catalog (ADR 0018 in the app),
including the ones that shipped inside the app. Anyone can propose a new one;
the official ids below are published only by the maintainers.

`manifest` describes the type as data. It picks mechanisms the app core already
has and never brings code:

- `category`, `logo` (or `null`), `color` (hex without `#`);
- `methods`, in the order the screen offers them, each type at most once:
  - `oauth`, with optional `scopes`;
  - `token`, with optional `header` (remote server) or `env` (local server)
    that carries the credential;
  - `cli` with `reader: "gh"`, the credential of another command line tool;
  - `session` with `reader: "browser-cookie"` or `"slack-desktop"`, the session
    the person already has. Cookie and domain live in the reader, in the app;
  - `none`.

  `cli` and `session` read a credential from the person's machine, so only
  official types use them.
- `fields`: the form an instance fills besides its name, each with `key`,
  `label`, optional `help`, `format` (`url` or `text`) and `required`;
- `servers`, at least one of:
  - `remote`: `{"url": "https://..."}` for a fixed address, or
    `{"urlField": "<key>"}` when the person types the address in a required
    `url` field. Optional `headers`, where `${credential}` goes;
  - `local`: `{"image": "registry/name@sha256:<64 hex>"}` or
    `{"package": {"registry": "npm", "name", "version", "bin", "lockfile"}}`,
    with optional `args` and `env`. Not accepted in the catalog yet: the app
    pins local servers in a later release.
- `triggers`: trigger kinds of the core that read this type (`poll` reads
  `github`, `slack-inbox` reads `slack`...) or one of its servers (`mcp-poll`);
- `actions`: flow actions of the core that need the type, as `<id>.<action>`;
- `trackers`, `scopeKeys` (prefixed by the id), `hosts`, `aliases` and
  `packages`, which identify the type;
- `writeTools`: the server tools that write outside the machine.

A type without `servers`, `triggers` or `actions` does nothing and is refused.
The schema is [`schemas/connection.schema.json`](schemas/connection.schema.json).

### What is refused

- `command`, `npx`, `uvx` or any other way of running a script.
- A remote `url` that is not https, carries a user or password, has a
  placeholder (`${credential}` included, it would end up in logs), writes the
  host differently from its canonical form (lowercase ASCII, punycode, no
  trailing dot, which catches homographs) or points to an IP address,
  `localhost`, a single-label name or a private suffix (`.local`, `.localhost`,
  `.localdomain`, `.internal`, `.intranet`, `.corp`, `.private`, `.home`,
  `.home.arpa`, `.lan`, `.test`, `.example`, `.invalid`). The same holds for
  `hosts`.
- `${credential}` anywhere but a header of the remote server or the `env` of
  the local one, and any other placeholder in a header.
- A trigger kind, tracker kind or action the core does not have
  ([`scripts/lib/core-kinds.json`](scripts/lib/core-kinds.json) and the
  triggers in the template schema), a trigger that reads another type, and an
  action or a scope key without the type id as prefix.
- A host, alias, package, tracker or action that another type already claims,
  official types included, and an alias equal to the id of another type.
- On local servers: an image without digest or with a tag next to it, runtime
  flags that widen the container (`--privileged`, `-v`, `--network`...), env
  names that change how the process loads code or reaches the network
  (`NODE_OPTIONS`, `NODE_TLS_REJECT_UNAUTHORIZED`, `ELECTRON_RUN_AS_NODE`,
  `SSLKEYLOGFILE`, `LD_*`, `DYLD_*`, `PATH`, `PYTHONPATH`, proxies...), and
  lockfile entries without `integrity`, resolved outside
  `https://registry.npmjs.org/` or with an install script.
- The ids `locum` and `proprio`, which the app reserves, and an id equal to an
  alias of an official type (the app matches a server name by id first).

### Official ids

The ids in [`scripts/lib/official-connections.json`](scripts/lib/official-connections.json)
(`github`, `slack`, `teams`, `grafana`, `prelo`, `argocd` and the others that
shipped inside the app) are published only by the maintainers.
[`.github/CODEOWNERS`](.github/CODEOWNERS) gives each `connections/<id>.json`
of them to the owners of CODEOWNERS itself, and `npm run validate` fails when
one is missing or owned by someone else. The owners only gate a merge once
branch protection on `main` requires code owner review, which is not on yet
(see [docs/connections-pending.md](docs/connections-pending.md)). No other type may claim the hosts, aliases, packages and
trackers listed for them.

### How the app will receive it, and versions

None of this works in the app yet: no released version installs connection
types from the catalog. The app will read connection types from the signed
index, the one built into it and the one from the network (ADR 0018, slice 2).
An installed type will stay pinned to the commit and the `sha256` of its file.
When `version` goes up, the app will show the update with what changed
(slice 5):

- a change that does not widen what the type asks for (text, icon, a field, a
  read-only tool) will come in on its own, unless the person turned off
  "update on its own" for that connection;
- a change that widens it (a new host, scope, method, write tool, image or
  package) will always wait for the person to accept, and the credential will
  never go to a new host before that.

`minAppVersion` is required in a connection type, at `0.1.168` or newer: no
earlier release installs connection types. When the release that reads them
comes out, the floor goes up to its version. Raise it when the type uses a method, reader, trigger kind or action
that older apps do not have: they will show the type as needing an update and
keep the installed one running.

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
