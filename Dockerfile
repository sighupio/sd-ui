# syntax=docker/dockerfile:1

# Where the SD plugin bundles come from:
#   build (default) - compiled from plugins/*/src here, from the lockfiles: CI and releases
#   local           - the plugins/*/dist/main.js already built on the host (`npm run build`):
#                     the fast inner loop of Tilt and the OnPremises dev environment
ARG PLUGINS_SOURCE=build

# Download official Headlamp plugins from GitHub Releases
FROM --platform=$BUILDPLATFORM alpine:3.21 AS plugins-downloader
RUN apk add --no-cache wget
RUN mkdir -p /plugins && \
    wget -qO- https://github.com/headlamp-k8s/plugins/releases/download/cert-manager-0.1.0/headlamp-k8s-cert-manager-0.1.0.tar.gz \
    | tar xz -C /plugins/

# The bundles are plain JavaScript, so both plugin stages run on the build platform
# (no QEMU) and every target platform reuses the same /out/<plugin>/{main.js,package.json}.
FROM --platform=$BUILDPLATFORM node:22.17.0-alpine AS plugins-build
WORKDIR /src
COPY plugins/ plugins/
RUN --mount=type=cache,target=/root/.npm \
    set -eu; \
    for dir in plugins/sd-*/; do \
      name=$(basename "$dir"); \
      echo "=== Building $name"; \
      (cd "$dir" && npm ci --no-audit --no-fund && npm run build); \
      mkdir -p "/out/$name"; \
      cp "$dir/dist/main.js" "$dir/package.json" "/out/$name/"; \
    done

FROM --platform=$BUILDPLATFORM alpine:3.21 AS plugins-local
WORKDIR /src
COPY plugins/ plugins/
RUN set -eu; \
    for dir in plugins/sd-*/; do \
      name=$(basename "$dir"); \
      if [ ! -f "$dir/dist/main.js" ]; then \
        echo "$name: dist/main.js missing, run 'mise run plugins-build' first" >&2; exit 1; \
      fi; \
      mkdir -p "/out/$name"; \
      cp "$dir/dist/main.js" "$dir/package.json" "/out/$name/"; \
    done

FROM plugins-${PLUGINS_SOURCE} AS plugins

FROM registry.sighup.io/fury/headlamp:v0.40.1

# Official plugins (from downloader stage)
COPY --from=plugins-downloader /plugins/cert-manager/ /headlamp/plugins/cert-manager/

# Theme plugin: third-party, vendored pre-built (flat structure, no sources here)
COPY plugins/headlamp-reevo-theme/main.js plugins/headlamp-reevo-theme/package.json /headlamp/plugins/headlamp-reevo-theme/

# SD plugins: every plugins/sd-* directory, no per-plugin list to keep in sync
COPY --from=plugins /out/ /headlamp/plugins/
