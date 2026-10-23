# Connection types: what is closed and what is left

Connection types with a remote server are accepted (ADR 0018 in the app,
slice 1). A local server is accepted in `connections/` only in an official
type and only by image pinned by digest, which the app runs with `docker run`
since its slice 3a.1a. A package, and any local server of a third-party type,
is still refused: the schema and the rules for them stay, tested by the
fixtures in `test/fixtures/connections/`, and
`validateCatalog(root, { localServers: true })` reads the folder as it will be
once the app pins them.

The review of the first PR found the gaps below. Each one closed in the catalog
has a rule in `scripts/lib/rules.mjs` or `scripts/lib/validate.mjs` and a test.

## Closed in the catalog

- **npm `resolved`**: every lockfile entry resolves from
  `https://registry.npmjs.org/`.
- **Lockfile root**: holds only the declared dependency (kept).
- **`env` names**: names that change how a process loads code, what it trusts
  or where its traffic goes (`NODE_OPTIONS`, `NODE_PATH`, `LD_*`, `DYLD_*`,
  `PATH`, `PYTHONPATH`, `NODE_TLS_REJECT_UNAUTHORIZED`, `SSLKEYLOGFILE`,
  `ELECTRON_RUN_AS_NODE`, proxies, CA bundles and the like) are refused in
  `env` and in the `env` of a `token` method.
- **Image `args`**: decided that the app builds the run command and `args` go
  after the image, to the server. The rule also refuses runtime flags that
  widen the container (`--privileged`, `-v`, `--volume`, `--mount`,
  `--network`, `--cap-add`, `--pid` and the like, also with the value attached,
  as in `-v/:/host` or `--volume=/:/host`), as defense in depth.
- **Image with tag and digest**: refused; the digest is what runs, so the tag
  only misleads.
- **`${credential}` in the url**: refused, like any marker in the url other
  than `${field:<key>}` in its path. The credential goes only in a header of the remote server or in the `env` of the
  local one, and nowhere else in the manifest.
- **Userinfo in the url**: refused.
- **Local, private and metadata addresses**: the url and every entry in
  `hosts` must be a public DNS name. IP addresses (any notation, v4 and v6),
  `localhost`, single-label names and the suffixes `.local`, `.localhost`,
  `.localdomain`, `.internal`, `.intranet`, `.corp`, `.private`, `.home`,
  `.home.arpa`, `.lan`, `.test`, `.example` and `.invalid` are refused.
- **Canonical host**: the url host must be written as the app compares it,
  lowercase ASCII (punycode) without a trailing dot, which refuses homographs
  such as a Cyrillic letter in a known name. Claims and the index use the
  canonical form.
- **Identity of the type**: hosts (url host included), aliases, packages,
  trackers and actions belong to one type across the catalog, and an alias
  cannot be the id of another type. A conflict between two items points to
  both files. An id equal to an alias of an official type is refused, since
  the app matches a server name by id before alias. The official types, which still ship in
  the app until slice 4, are listed with their hosts, aliases, packages and trackers in
  `scripts/lib/official-connections.json`, so no other type can claim them.
- **Same schema as the app**: what `tipos-do-indice.ts` and
  `servidor-do-manifesto.ts` in the app accept and refuse, the catalog does too.
  `servers.remote.path` only with `urlField`, without markers or `.` and `..`
  segments; `${field:<key>}` of a declared field in the url (path only),
  headers, `args` and `env`, and no other marker; `${credential}` in one place
  of each server, the one the `token` method declares; the env names that
  change the `docker` that runs the server (`DOCKER_*`) or that the MCP client
  sets (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`) refused next to the
  loader ones; no free `text` field in the server that receives the
  credential, in every type as in the app; `minAppVersion` `0.1.170` or newer
  when the type uses `path` or a field marker; no display name of an official
  type or of `proprio`; and the package of a local server claimed like
  `packages`.
- **Official types published**: the types in the app's `embutidos.json`, all
  but the reserved `proprio`, are in `connections/` with the same content. The
  app keeps ignoring an index type with an official id until its slice 4, so
  publishing them changes nothing for anyone yet.
- **Core kinds**: trigger kinds come from the template schema; tracker kinds
  and actions from `scripts/lib/core-kinds.json`, copied from the app.
- **Machine credentials**: `cli` and `session` read a credential from the
  person's machine and are accepted only in official ids, whose files
  CODEOWNERS gives to the maintainers.

## Left to the app (later slices of ADR 0018)

- **`minAppVersion`**: required in every connection type, at
  `0.1.168` or newer (compared as numbers), the release of slice 2, the first
  that reads connection types from the index. The official types use the
  floor, except Grafana and Prelo, at `0.1.170`, the first release whose schema
  takes `servers.remote.path` and the `${field:<key>}` markers. Slice 4 of the
  app, the first that installs an official type from here, may need to raise
  them to its version.
- **`mcp-poll` in many types**: the catalog accepts `mcp-poll` in more than one
  type, since it is a generic trigger of the core that reads a server, not a
  connection. The app maps each trigger kind to one connection type
  (`conexaoDoGatilho`); slice 2 has to read `mcp-poll` by the server it names
  instead.
- **`hasInstallScript`**: declared by whoever contributes, so a lockfile can
  leave it out. The real defense will be the app installing with
  `--ignore-scripts` (slice 6, local servers).
- **Address typed by the person** (`urlField`): the catalog cannot see it. The
  app will have to refuse, when the instance is saved, a non-https, local or
  private address for a type from a third party. That rule is for third-party
  types: an official type in the `home` category may accept http to the
  person's own machine, as the prelo type does today.
- **Names that resolve to a private address**: the catalog checks names, not
  DNS. The app will have to check the resolved address when it connects, and
  not follow a redirect to another host.
- **Token only for the declared host**: the app will send the credential only
  to the host of the remote server, and a new host in an update will wait for
  the person to accept (slice 5).
- **Index `requires`**: connections reach the index with servers, hosts,
  methods (with the reader), scopes, fields, triggers, actions and write tools.
  The app will read it on the install screen in slice 2.

## Left open between the catalog and the app

- **Local servers of third parties and packages**: the app schema accepts them
  (the type shows as not installable yet, and a package as not installed); the
  catalog refuses them in `connections/` until the app pins them (slice 6).
  The catalog is stricter here, which is the safe direction.
- **Closed list (`enum`) in a field**: ADR 0018 lets a third-party field in
  the server that receives the credential be a closed list. Neither schema has
  `enum` yet; it comes to both at once.
- **`kind` and `url` of `embutidos.json`**: `kind` (`github`, `oauth`,
  `panel`) is provisional in the app, only for its embedded manifests, and the
  app schema for index types refuses it, so it is not published. The top level
  `url` is published as `servers.remote.url`, the shape of the catalog. Slice 4
  of the app has to decide how it connects from `methods` and `servers`.
- **`argocd`**: on the official list so that nobody takes the id or the server
  name the templates ask for, but the app has no type for it (no server,
  trigger or action), and a manifest without them is refused. No file until
  the app has one.
- **`path` in the index**: `requires.servers.remote` carries `urlField` but not
  `path`. The install screen of slice 3 shows the address the credential goes
  to; it needs `path` there, or reads the manifest.
- **Rules the catalog has and the app schema does not**: canonical and public
  hosts, and `${credential}` anywhere outside a header or env (a label, for
  one). A method type or a field key twice is refused by both: the app checks
  them in `checkTypeIdentity`. A manifest the catalog refuses never reaches
  the index.
- **`kind` in slice 4 of the app**: the app still reads `kind` of
  `embutidos.json` (`migracao-instancias.ts`, `connection-service.ts`,
  `execution-service.ts`), and the catalog does not keep it. It can be derived
  from `methods` and `servers` (`oauth` with a fixed remote url, `panel` with
  fields and servers), except `github`, which only comes out of the id.
- **Who is official without `embutidos.json`**: slice 4 of the app still
  needs to know which types are official, for `official-id`,
  `official-alias`, the name conflict and the home network in the `urlField`
  of Prelo, which only an official type in the `home` category may accept.
  The catalog keeps that in `scripts/lib/official-connections.json` and
  CODEOWNERS, which do not reach the index. The ways out are a fixed list in
  the app or a mark signed in the index. Not decided.

## Outside the code

- **Branch protection**: `main` has no protection today. Until the owner turns
  on "Require review from Code Owners" and makes the `validate` check
  required, CODEOWNERS only asks for review and does not hold a merge. That is
  a repository setting, for the owner to do. The `@locumapp/maintainers` team
  in CODEOWNERS already exists in the organization.
- **Author check**: ADR 0018, decision 4, says the validator checks the author
  of a change to an official id. That check does not exist yet: `npm run
  validate` only checks that CODEOWNERS covers the official files.
