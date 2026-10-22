# Connection types: what to close before opening them

Connection types are not accepted yet (decision 1 of ADR 0016 in the app):
the validator refuses any file in `connections/`, and the index leaves them
out. The schema in `schemas/connection.schema.json` and the rules in
`scripts/lib/rules.mjs` stay, tested by the fixtures in
`test/fixtures/connections/`, and `validateCatalog(root, { connections: true })`
reads the folder as it will once open.

The review of the first PR found these gaps. Each one needs a rule and a
fixture before connection types open.

## npm packages

- `resolved` takes any https host. Restrict it to
  `https://registry.npmjs.org/`.
- `hasInstallScript` is declared by whoever contributes, so a lockfile can
  simply leave it out. The real defense is the app installing with
  `--ignore-scripts`; the rule here only catches the honest case.
- The lockfile root must hold only the declared dependency. This is already
  enforced; keep it when the rules change.

## Environment and arguments

- `env` accepts any name. Refuse names that change how a process loads code:
  `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`,
  `PATH`, `PYTHONPATH` and the like.
- `args` of an image reach the container runtime. Refuse what widens the
  container, such as `-v /:/host`, `--privileged`, `--network host`,
  `--cap-add` and `--pid host`, or decide that the app builds the run command
  and `args` only go to the server.

## Images

- An image with both a tag and a digest (`name:tag@sha256:...`) passes. Decide
  whether the tag is allowed as a label or refused, since the digest is what
  runs.

## Remote servers

- `url` may carry `${credential}` in the query string, where it ends up in
  logs. Refuse it; the credential goes in a header.
- `url` may carry userinfo (`https://user:pass@host`). Refuse it.
- `url` may point to a local address, a private range or a cloud metadata
  endpoint (`localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `169.254.169.254`,
  `::1`, `.local`). Refuse them.

## Identity of the type

- `hosts`, `aliases` and `packages` may collide with the built-in types of the
  app and with other items in the catalog, which would make a server match two
  types. Check both, like `carregarManifestos` does in the app.

## Index

- `requires` for a connection is built and tested, but no connection reaches
  the index yet. Check that the app reads it as the install screen expects
  before opening.
