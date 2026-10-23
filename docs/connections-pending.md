# Connection types: what is closed and what is left

Connection types with a remote server are accepted (ADR 0018 in the app,
slice 1). Local servers are still refused in `connections/`: the schema and
the rules for them stay, tested by the fixtures in `test/fixtures/connections/`,
and `validateCatalog(root, { localServers: true })` reads the folder as it will
be once the app pins them.

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
- **`${credential}` in the url**: refused, like any placeholder in the url. The
  credential goes only in a header of the remote server or in the `env` of the
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
- **Core kinds**: trigger kinds come from the template schema; tracker kinds
  and actions from `scripts/lib/core-kinds.json`, copied from the app.
- **Machine credentials**: `cli` and `session` read a credential from the
  person's machine and are accepted only in official ids, whose files
  CODEOWNERS gives to the maintainers.

## Left to the app (later slices of ADR 0018)

- **`minAppVersion`**: required in every connection type, at
  `0.1.168` or newer (compared as numbers). 0.1.167 is the last release, and
  it does not install connection types, so installed apps show "needs an
  update". When the release of slice 2 comes out, the floor in
  `scripts/lib/rules.mjs` goes up to its version, and the published items go
  up with it in the same PR.
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

## Outside the code

- **Branch protection**: `main` has no protection today. Until the owner turns
  on "Require review from Code Owners" and makes the `validate` check
  required, CODEOWNERS only asks for review and does not hold a merge. That is
  a repository setting, for the owner to do. The `@locumapp/maintainers` team
  in CODEOWNERS also has to be created in the organization.
- **Author check**: ADR 0018, decision 4, says the validator checks the author
  of a change to an official id. That check does not exist yet: `npm run
  validate` only checks that CODEOWNERS covers the official files.
