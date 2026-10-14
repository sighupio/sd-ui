# SIGHUP Distribution UI Maintenance Guide

This document is for the SIGHUP Distribution UI maintainers. Here you will find instructions on how to release a new version of the UI image.

## Releasing a new version

Releases are fully automated by the pipeline in [`.github/workflows/pipeline.yml`](.github/workflows/pipeline.yml) and are triggered by pushing a version tag.

1. Be sure that the current state of the `main` branch is ready to be released.
2. Write the release notes in `docs/releases/<tag>.md` (for example `docs/releases/v1.2.3.md`) and merge them into `main`.
3. Tag `main` and push the tag:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

Tags must match `vX.Y.Z` (stable) or `vX.Y.Z-rc.N` (release candidate).

## What the pipeline does on a tag

Besides the lint and build jobs that run on every push (see [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md#ci-checks)), a tag also runs:

1. **Build & push image**: assembles the Headlamp image with all plugins for `linux/amd64` and `linux/arm64` in a single multi-arch build and pushes it to `registry.sighup.io/fury/sd-ui`. CVE scanning and patching happen downstream in [container-image-sync](https://github.com/sighupio/container-image-sync), which publishes `registry.sighup.io/fury-secured/sd-ui`.
2. **GitHub Release**: created from the tag.

| You push        | Image tags                           | GitHub Release                          |
| --------------- | ------------------------------------ | --------------------------------------- |
| `v1.2.3`        | `v1.2.3`, `latest`, `<sha>`          | **Release v1.2.3**                      |
| `v1.2.3-rc.1`   | `v1.2.3-rc.1`, `<sha>` (no `latest`) | **Preview v1.2.3-rc.1** (pre-release)   |

Release notes: if `docs/releases/<tag>.md` exists, it is used as the release body (with a Docker images section appended); otherwise GitHub auto-generates the notes from commit history.

## Quick rules of thumb

- **Tag `vX.Y.Z-rc.N`**: an image and a pre-release "Preview" for testing. Does **not** move `latest`.
- **Tag `vX.Y.Z`**: a stable release; moves the `latest` image tag and publishes a GitHub Release.
