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
  `PATH`, `PYTHONPATH`, proxies, CA bundles and the like) are refused in
  `env` and in the `env` of a `token` method.
- **Image `args`**: decided that the app builds the run command and `args` go
  after the image, to the server. The rule also refuses runtime flags that
  widen the container (`--privileged`, `-v`, `--volume`, `--mount`,
  `--network`, `--cap-add`, `--pid` and the like), as defense in depth.
- **Image with tag and digest**: refused; the digest is what runs, so the tag
  only misleads.
- **`${credential}` in the url**: refused, like any placeholder in the url. The
  credential goes only in a header of the remote server or in the `env` of the
  local one, and nowhere else in the manifest.
- **Userinfo in the url**: refused.
- **Local, private and metadata addresses**: the url and every entry in
  `hosts` must be a public DNS name. IP addresses (any notation, v4 and v6),
  `localhost`, single-label names and the suffixes `.local`, `.localhost`,
  `.internal`, `.home.arpa` and `.lan` are refused.
- **Identity of the type**: hosts (url host included), aliases, packages,
  trackers and actions belong to one type across the catalog, and an alias
  cannot be the id of another type. The official types, which still ship in
  the app until slice 4, are listed with their hosts, aliases, packages and trackers in
  `scripts/lib/official-connections.json`, so no other type can claim them.
- **Machine credentials**: `cli` and `session` read a credential from the
  person's machine and are accepted only in official ids, whose files
  CODEOWNERS gives to the maintainers.

## Left to the app (later slices of ADR 0018)

- **`hasInstallScript`**: declared by whoever contributes, so a lockfile can
  leave it out. The real defense is the app installing with `--ignore-scripts`
  (slice 6, local servers).
- **Address typed by the person** (`urlField`): the catalog cannot see it. The
  app refuses a non-https, local or private address when the instance is saved.
- **Names that resolve to a private address**: the catalog checks names, not
  DNS. The app checks the resolved address when it connects, and does not
  follow a redirect to another host.
- **Token only for the declared host**: the app sends the credential only to
  the host of the remote server, and a new host in an update waits for the
  person to accept (slice 5).
- **Index `requires`**: connections now reach the index with servers, hosts,
  methods, scopes, fields, triggers, actions and write tools. The app reads it
  on the install screen in slice 2.

## Outside the code

- **Code owner review**: CODEOWNERS only gates a merge when branch protection
  on `main` requires review from code owners. That is a repository setting.
