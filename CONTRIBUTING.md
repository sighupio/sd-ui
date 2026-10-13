# Contributing

Thanks for contributing to the SIGHUP Distribution UI. This guide is intentionally short: how to make a change, and what the CI/CD pipeline does when you push.

## Making a change

1. **Branch off `main`** and make your change in the relevant `plugins/<name>/` directory.
2. **Build the plugin.** The built `dist/main.js` is committed to git (the `Dockerfile` copies it directly), so after editing `src/` you must rebuild and commit the result:
   ```bash
   cd plugins/<name>
   npm install
   npm run tsc      # type-check
   npm run lint     # lint (must pass)
   npm run build    # regenerates dist/main.js
   ```
   Or for every plugin at once: `mise run plugins-build`.
3. **Stage files explicitly** — include both your `src/` changes and the regenerated `dist/main.js`. Don't use `git add -A`/`git add .`.
4. **Open a pull request against `main`.**

If you change infrastructure (RBAC, Capsule, auth), update the relevant docs under `docs/` — see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). For a new plugin, follow [`docs/HOW_TO_DEVELOP_A_PLUGIN.md`](docs/HOW_TO_DEVELOP_A_PLUGIN.md).

## What the CI/CD pipeline does

The pipeline is defined in [`.github/workflows/pipeline.yml`](.github/workflows/pipeline.yml). It runs **on every push to any branch** and **on version tags**, and publishes the image **only on version tags**.

### When you push a commit (any branch)

1. **Discover plugins** — builds a matrix of every `plugins/sd-*` plugin.
2. **Lint** (parallel, per plugin) — `npm install`, `npm run tsc`, `npm run lint`.
   _(Unit tests are wired up but commented out until tests are added.)_
3. **Build** (parallel, per plugin) — `npm run build`, uploads each `dist/main.js` as an artifact.

No image is published: a push only checks that every plugin lints and builds.

### When you push a tag

Tags must match `vX.Y.Z` (stable) or `vX.Y.Z-rc.N` (release candidate).

Everything above runs, plus:

4. **Build & push image** — assembles the Headlamp image with all plugins for `linux/amd64` and `linux/arm64` in a single multi-arch build and pushes it to `registry.sighup.io/fury/sd-ui` (CVE scanning and patching happen downstream in [container-image-sync](https://github.com/sighupio/container-image-sync), which publishes `registry.sighup.io/fury-secured/sd-ui`).
5. **GitHub Release** — created from the tag.

| You push        | Image tags                           | GitHub Release                          |
| --------------- | ------------------------------------ | --------------------------------------- |
| `v1.2.3`        | `v1.2.3`, `latest`, `<sha>`          | **Release v1.2.3**                      |
| `v1.2.3-rc.1`   | `v1.2.3-rc.1`, `<sha>` (no `latest`) | **Preview v1.2.3-rc.1** (pre-release)   |

Release notes: if `docs/releases/<tag>.md` exists, it is used as the release body (with a Docker images section appended); otherwise GitHub auto-generates the notes from commit history.

### Quick rules of thumb

- **Push to a feature branch** → lint + build only. Use the Kind environment (`mise run up` + `mise run dev`) to try your change.
- **Tag `vX.Y.Z-rc.N`** → an image and a pre-release "Preview" for testing. Does **not** move `latest`.
- **Tag `vX.Y.Z`** → a stable release; moves the `latest` image tag and publishes a GitHub Release.
