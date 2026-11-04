# SIGHUP Distribution UI Release vX.Y.Z

This release bumps [Headlamp](https://headlamp.dev) to `v0.46.0`.

## Image 🚢

| Component  | Version                                                                         | Previous Version                                                              |
| ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `sd-ui`    | `vX.Y.Z`                                                                        | `v1.0.0`                                                                      |
| `headlamp` | [`v0.46.0`](https://github.com/kubernetes-sigs/headlamp/releases/tag/v0.46.0)   | [`v0.40.1`](https://github.com/kubernetes-sigs/headlamp/releases/tag/v0.40.1) |

## Included plugins

`sd-core` now lists the service links rendered by the distribution instead of a hardcoded set.

| Plugin                     | Version  | Description                                                                                |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `sd-core`                  | `1.0.0`  | Cluster landing page with distribution version, module status and resource usage charts.    |
| `sd-alerts`                | `1.0.0`  | Prometheus alerts grouped by rule group, with labels, graph queries and runbook links.      |
| `sd-certificates`          | `1.0.0`  | X.509 certificate expiry tracking via the `x509_cert_not_after` Prometheus metric.           |
| `sd-events`                | `1.0.0`  | Historical Kubernetes events from Loki or OpenSearch.                                       |
| `sd-logs`                  | `1.0.0`  | Log viewer with Loki and OpenSearch backends.                                                |
| `sd-backups`               | `1.0.0`  | Velero backup, restore and schedule dashboard.                                               |
| `sd-policy`                | `1.0.0`  | Policy violations from Kyverno PolicyReports or Gatekeeper constraint status.                |
| `sd-loki-links`            | `1.0.0`  | "View Logs" links on workload detail pages, to Grafana Explore or OpenSearch Dashboards.     |
| `sd-prometheus-autoconfig` | `1.0.0`  | Auto-configures the Headlamp Prometheus plugin address. No UI.                               |
| `headlamp-reevo-theme`     | `1.0.0`  | Custom dark theme.                                                                           |
| `cert-manager`             | `0.1.0`  | Upstream [Headlamp plugin](https://github.com/headlamp-k8s/plugins) for cert-manager resources. |

## Changes

- Base image bumped to `registry.sighup.io/fury/headlamp:v0.46.0`.
- The `desktop-build` task now builds Headlamp Desktop from the `v0.46.0` tag.
- Plugin `package.json` versions aligned to `1.0.0`, the version published in the `v1.0.0` release notes (they were still `0.1.0`).
- `sd-core` reads the service links from the `links` list of the `headlamp/sd-spec` ConfigMap, so a new module or UI needs a change in the distribution template only. Modules known only from their links get their own row. A distribution version that does not render `links` shows no links. The other plugins' `sdSpec.ts` parser is updated to keep the shared copy identical.
