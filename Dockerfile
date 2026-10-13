# Download official Headlamp plugins from GitHub Releases
FROM alpine:3.21 AS plugins-downloader
RUN apk add --no-cache wget
RUN mkdir -p /plugins && \
    wget -qO- https://github.com/headlamp-k8s/plugins/releases/download/cert-manager-0.1.0/headlamp-k8s-cert-manager-0.1.0.tar.gz \
    | tar xz -C /plugins/

FROM registry.sighup.io/fury/headlamp:v0.40.1

# Official plugins (from downloader stage)
COPY --from=plugins-downloader /plugins/cert-manager/ /headlamp/plugins/cert-manager/

# Copy pre-built plugins (main.js + package.json only)
# Theme plugin (already has flat structure)
COPY plugins/headlamp-reevo-theme/main.js /headlamp/plugins/headlamp-reevo-theme/main.js
COPY plugins/headlamp-reevo-theme/package.json /headlamp/plugins/headlamp-reevo-theme/package.json

# SD plugins (built with headlamp-plugin build, main.js is in dist/)
COPY plugins/sd-core/dist/main.js /headlamp/plugins/sd-core/main.js
COPY plugins/sd-core/package.json /headlamp/plugins/sd-core/package.json

COPY plugins/sd-events/dist/main.js /headlamp/plugins/sd-events/main.js
COPY plugins/sd-events/package.json /headlamp/plugins/sd-events/package.json

COPY plugins/sd-certificates/dist/main.js /headlamp/plugins/sd-certificates/main.js
COPY plugins/sd-certificates/package.json /headlamp/plugins/sd-certificates/package.json

COPY plugins/sd-prometheus-autoconfig/dist/main.js /headlamp/plugins/sd-prometheus-autoconfig/main.js
COPY plugins/sd-prometheus-autoconfig/package.json /headlamp/plugins/sd-prometheus-autoconfig/package.json

COPY plugins/sd-alerts/dist/main.js /headlamp/plugins/sd-alerts/main.js
COPY plugins/sd-alerts/package.json /headlamp/plugins/sd-alerts/package.json

COPY plugins/sd-loki-links/dist/main.js /headlamp/plugins/sd-loki-links/main.js
COPY plugins/sd-loki-links/package.json /headlamp/plugins/sd-loki-links/package.json

COPY plugins/sd-backups/dist/main.js /headlamp/plugins/sd-backups/main.js
COPY plugins/sd-backups/package.json /headlamp/plugins/sd-backups/package.json

COPY plugins/sd-policy/dist/main.js /headlamp/plugins/sd-policy/main.js
COPY plugins/sd-policy/package.json /headlamp/plugins/sd-policy/package.json

COPY plugins/sd-logs/dist/main.js /headlamp/plugins/sd-logs/main.js
COPY plugins/sd-logs/package.json /headlamp/plugins/sd-logs/package.json
