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

In `name` and `description`, of any kind, the validator refuses a character
that hides or reorders what the person reads: bidi controls (U+061C, U+200E,
U+200F, U+202A to U+202E, U+2066 to U+2069), a zero width character on its own
(U+200B, U+2060, U+FEFF) and control characters other than `\n` and `\t`. In
a connection type the app refuses them too; in a template or a package only
the catalog checks. ZWJ (U+200D), ZWNJ (U+200C) and the soft hyphen
(U+00AD) pass: they compose emoji, like `👩‍💻`, and words.

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
  `label`, optional `help`, optional `placeholder` (the hint shown in the
  empty field, like the default address, never saved as the value), `format`
  (`url` or `text`) and `required`. `help` and `placeholder` are texts in both
  languages, like `label`;
- `servers`, at least one of:
  - `remote`: `{"url": "https://..."}` for a fixed address, or
    `{"urlField": "<key>"}` when the person types the address in a required
    `url` field, with an optional `path` added to its end (`"/mcp"`, without
    markers or `.` and `..` segments). Optional `headers`, where
    `${credential}` goes;
  - `local`: `{"image": "registry/name@sha256:<64 hex>"}` or
    `{"package": {"registry": "npm", "name", "version", "bin", "lockfile"}}`,
    with optional `args` and `env`. In the catalog, only an official type
    publishes a local server, and only by image, which the app runs with
    `docker run`; a package and a local server from a third party wait for
    the app to pin them in a later release.

  The values of `url` (in the path only), `headers`, `args` and `env` take
  `${field:<key>}`, the value of a field declared in `fields`. `${credential}`
  goes in one place of each server, a header of the remote one or a variable of
  the local one, and it is the place the `token` method declares in `header` or
  `env`, when it does.
- `healthCheck`: the instance test, up to three GETs on the base of the remote
  server (the address in `urlField`, or `servers.remote.url`), each with a
  `path` and the `fields` of the JSON answer to show, from 1 to 10, each with a
  first level `key` and a `label`:

  ```json
  "healthCheck": [
    { "path": "/api/health", "fields": [{ "key": "version", "label": { "en": "Version", "pt-BR": "Versão" } }] }
  ]
  ```

  The `path` is relative and added to the end of the base: it starts with `/`
  and has no `.` or `..` segment, scheme, host, query, fragment or marker.
  Only with `servers.remote`;
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
- A remote `url` that is not https, carries a user or password, has
  `${credential}` (it would end up in logs) or `${field:...}` outside the path
  (in the host, the port, the query or the fragment), writes the
  host differently from its canonical form (lowercase ASCII, punycode, no
  trailing dot, which catches homographs) or points to an IP address,
  `localhost`, a single-label name or a private suffix (`.local`, `.localhost`,
  `.localdomain`, `.internal`, `.intranet`, `.corp`, `.private`, `.home`,
  `.home.arpa`, `.lan`, `.test`, `.example`, `.invalid`). The same holds for
  `hosts`.
- A fixed remote `url` on a host left out of `hosts`, when the type declares
  `hosts`: the app does not install the type, since the token would go to a
  host the person did not see. Without `hosts` there is nothing to compare;
  the port does not count.
- The same characters refused in `name` and `description` (see the envelope)
  in the `label`, `help` and `placeholder` of a field, the `label` of a
  `healthCheck` field, the `description` of a scope key, the `scopes` of the
  `oauth` method and `writeTools`.
- `${credential}` anywhere but a header of the remote server or the `env` of
  the local one, in more than one place of the same server or outside the
  place the `token` method declares; a marker that is neither `${credential}`
  nor `${field:<key>}` of a declared field; `path` without `urlField`.
- `healthCheck` without `servers.remote`; a GET `path` that is not relative
  and clean (as the `path` of the remote server) or that appears twice; a field
  key repeated in the same GET.
- In any type, official ones included, a `text` field used in the server
  that receives `${credential}`. Free text in a variable, an argument or a header
  can point the server to another host (`--base-url`, `API_HOST`) without the
  origin check the app applies to a `url` field. Use a `url` field.
- A trigger kind, tracker kind or action the core does not have
  ([`scripts/lib/core-kinds.json`](scripts/lib/core-kinds.json) and the
  triggers in the template schema), a trigger that reads another type, and an
  action or a scope key without the type id as prefix.
- A host, alias, package (the one of a local server included), tracker or
  action that another type already claims, official types included, and an
  alias equal to the id of another type.
- A display name equal to that of an official type or of `proprio`, in any
  case or accent: the app ignores the type that takes it.
- On local servers: an image without digest or with a tag next to it, runtime
  flags that widen the container (`--privileged`, `-v`, `--network`...), env
  names that change how the process loads code or reaches the network
  (`NODE_OPTIONS`, `NODE_TLS_REJECT_UNAUTHORIZED`, `ELECTRON_RUN_AS_NODE`,
  `SSLKEYLOGFILE`, `LD_*`, `DYLD_*`, `PATH`, `PYTHONPATH`, proxies...), change
  the `docker` that runs the server (`DOCKER_*`) or that the MCP client sets
  (`HOME`, `LOGNAME`, `SHELL`, `TERM`, `USER`), the same list as the app, and
  lockfile entries without `integrity`, resolved outside
  `https://registry.npmjs.org/` or with an install script.
- The ids `locum` and `proprio`, which the app reserves, and an id equal to an
  alias of an official type (the app matches a server name by id first).

### Official ids

The ids in [`scripts/lib/official-connections.json`](scripts/lib/official-connections.json)
(`github`, `slack`, `teams`, `grafana`, `argocd` and the others that
shipped inside the app) are published only by the maintainers.
[`.github/CODEOWNERS`](.github/CODEOWNERS) gives each `connections/<id>.json`
of them to the owners of CODEOWNERS itself, and `npm run validate` fails when
one is missing or owned by someone else. The owners only gate a merge once
branch protection on `main` requires code owner review, which is not on yet
(see [docs/connections-pending.md](docs/connections-pending.md)). No other type may claim the hosts, aliases, packages and
trackers listed for them.

The types that shipped inside the app are in `connections/`, with the same
content the app uses today. `argocd` is on the list so that nobody takes the id
or the server name the templates ask for, but the app has no type for it: it
has no file until it does.

Being official is a mark in the signed index, not something an item says.
`npm run build-index` adds `"official": true` to the entry of each connection
type whose id is in `official` on that list, and an item file that declares
`official` is refused. From the app release that reads the mark (ADR 0018,
slice 4), an official type has the trust the types inside the app have today:
the home network, the methods only official types use (`cli` and `session`)
and the GitHub token. A third-party type reaches only public addresses, and an
address on this machine only when the person types it. Older apps ignore the
mark. `prelo` is published by the maintainers, and CODEOWNERS keeps its file
with them, but it is a third-party type: it is not on the list, and its entry
in the index has no mark.

### How the app receives it, and versions

The app reads connection types from the signed index, the one built into it
and the one from the network (ADR 0018, slice 2), and "Add connection" lists
the third-party ones with their state: "Not installable yet", or "Needs a
newer Locum" when `minAppVersion` is above the app version. None installs yet;
installing is slice 3. A type in the index with an official id or alias is
ignored, and the official types keep coming from inside the app until slice 4,
which reads them from here. Until then, publishing or changing an official
type changes nothing for anyone using the app.

An installed type will stay pinned to the commit and the `sha256` of its file.
When `version` goes up, the app will show the update with what changed
(slice 5):

- a change that does not widen what the type asks for (text, icon, a field, a
  read-only tool) will come in on its own, unless the person turned off
  "update on its own" for that connection;
- a change that widens it (a new host, scope, method, write tool, image or
  package) will always wait for the person to accept, and the credential will
  never go to a new host before that.

`minAppVersion` is required in a connection type, at `0.1.168` or newer, the
first release that reads types from the index. Raise it when the type uses
something older apps do not have, a method, reader, trigger kind, action or
schema field: they will show the type as needing an update and keep the
installed one running. `path` and the `${field:<key>}` markers came into the
app schema in `0.1.170`: a type that uses them needs `0.1.170` or newer, as
Grafana does, and the validator refuses less. A field `placeholder` and
`healthCheck` came into the app catalog schema in `0.1.182`: a type that uses
them needs `0.1.182` or newer, as Prelo does, because older apps show the type
as invalid.

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

A trigger kind that has `filter` also takes `batch: {"windowMinutes", "max"}`
(`$defs.batch`, with the limits of the app: 1 to 10080 minutes and 1 to 500
events). Without it, each event is one run. With it, the events that pass the
filter join for the window and become one run, and that run reads the batch
event: `{{event.items}}` (the events, in the order they arrived),
`{{event.cut}}` (how many went past `max` and were left out),
`{{event.deferred}}`, `{{event.count}}`, `{{event.windowStart}}` and
`{{event.windowEnd}}` (`x-event-fields`). A step that reads another field, like
`{{event.channel}}`, is refused, because the batch event has none: read each
event inside `{{event.items}}`. `batch` in a kind without `filter` is refused,
and a template with `batch` needs `minAppVersion` `0.1.175` or newer, the first
app with batch. The window and the maximum are written in the template, never
left to the app. Also refused:

- `batch` in a trigger that leaves out a field in `x-required-to-run` that is
  not in `x-pending-choice` (`repoMatch` in `poll`): without it the app does
  not create the trigger on install, and drops it whole, batch included, until
  the person chooses. A trigger held by `x-held-by` or with an entry in
  `omitidos` is created with its whole config, and keeps its batch. A field
  also in `x-pending-choice` (`channels` in `slack-channel`) holds the trigger
  from app `0.1.177` on, with its whole config, until the person chooses: a
  template with `batch` in that trigger needs `minAppVersion` `0.1.177` or
  newer, because older apps drop it. A package declares no `minAppVersion`, so
  there the batch is still refused;
- a template where one trigger that brings an event has `batch` and another
  has not: a run of each reads a different event, and no prompt serves both.

`filter` (`$defs.filter`) follows the app too: at most 20 conditions, each with
`path` (the path in the event, like `author.login`), `compare` (the comparisons
of the `if` step) and `against` (up to 500 characters). `against` takes only
event markers, and with `matches` and no marker it must be a valid regular
expression.

Known limit: with batch, the app also warns about an action that takes its
target or scope from the event (a conversation reply, the GitHub thread
actions, `github.review_comment` without `owner`, `repo` and `pull`, the memory
scope) and is not inside a "for each" over `{{event.items}}`. The catalog does
not check it: the list lives in the app, with exceptions by parameter, and the
template schema has no "for each" yet. A template with batch should deliver
through an action that does not read a target from the event, like
`digest.deliver`.

Before opening the PR, check that no company data is left: names of people,
teams, channels, hosts and repositories must be generic.
