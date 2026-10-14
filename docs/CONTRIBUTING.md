# Contributing

Thanks for contributing to the SIGHUP Distribution UI! This guide covers how to make a change and get it merged.

## Making a change

1. **Branch off `main`** and make your change in the relevant `plugins/<name>/` directory.
2. **Check and build the plugin.** `dist/` is not committed: the `Dockerfile` compiles every plugin from source, so only `src/` (and `package.json`/`package-lock.json` when dependencies change) goes in your commit. Build locally to try the change:
   ```bash
   cd plugins/<name>
   npm ci
   npm run tsc      # type-check
   npm run lint     # lint (must pass)
   npm run build    # regenerates dist/main.js (gitignored, used by Tilt)
   ```
   Or for every plugin at once: `mise run plugins-build`.
3. **Try it locally** with the Kind environment (`mise run up` + `mise run dev`), see [`docs/DEVELOPMENT.md`](DEVELOPMENT.md).
4. **Stage files explicitly**: your `src/` changes, plus `package.json` and `package-lock.json` if you changed dependencies. Don't use `git add -A`/`git add .`.
5. **Open a pull request against `main`.**

If you change infrastructure (RBAC, Capsule, auth), update the relevant docs under `docs/`, see [`docs/DEVELOPMENT.md`](DEVELOPMENT.md). For a new plugin, follow [`docs/HOW_TO_DEVELOP_A_PLUGIN.md`](HOW_TO_DEVELOP_A_PLUGIN.md).

## CI checks

Every push, on any branch, runs the pipeline in [`.github/workflows/pipeline.yml`](../.github/workflows/pipeline.yml):

1. **Discover plugins**: builds a matrix of every `plugins/sd-*` plugin.
2. **Lint** (parallel, per plugin): `npm ci`, `npm run tsc`, `npm run lint`.
   _(Unit tests are wired up but commented out until tests are added.)_
3. **Image**: builds the image with the `Dockerfile`, which compiles every plugin from source (`npm ci` + `npm run build`).

A push only checks that every plugin lints and that the image builds; the image is published only for version tags. Your PR needs these checks green to be merged.

Releases are cut by maintainers, see [`MAINTENANCE.md`](../MAINTENANCE.md).
