# SD Flavor / Headlamp Plugin Compatibility Matrix

The SIGHUP Distribution (SD) lets each module be fulfilled by one of several alternative
tools ("flavors") — e.g. Loki *or* OpenSearch for logging. The Headlamp plugins detect the
active flavor by reading `modules.<name>.type` from the `headlamp/sd-spec` ConfigMap and adapt
(or hide) accordingly. This document tracks, **per module category**, the possible choices
and how each Headlamp feature behaves against them — a compatibility matrix for testing and
for catching gaps.

**Authoritative choices** are taken from the KFDDistribution schema
(`schemas/public/kfddistribution-kfd-v1alpha2.json`); **plugin behavior** from the plugin
source under `plugins/*/src/`.

Legend: ✅ works · ⚠️ conditional / needs care · ❌ not handled by the plugin · ➖ no
Headlamp dependency · ❓ untested (deploy that flavor and confirm).

---

## Module choices catalog (the "flavors")

| Category | `type` choices (KFD schema) | Sub-variants | Headlamp features that depend on it |
|---|---|---|---|
| **monitoring** | `none`, `prometheus`, `prometheusAgent`, `mimir` | — | sd-alerts, sd-certificates, sd-core (alerts+certs cards), sd-prometheus-autoconfig |
| **logging** | `none`, `loki`, `opensearch`, `customOutputs` | opensearch: `single`\|`triple` | sd-events, sd-logs, sd-loki-links (Grafana *or* OSD button), sd-core (OpenSearch Dashboards and MinIO links) |
| **policy** | `none`, `kyverno`, `gatekeeper` | — | sd-policy, sd-core (policy card) |
| **dr** | `none`, `on-premises` | — | sd-backups, sd-core (backups card) |
| **networking** | `none`, `calico`, `cilium` | — | sd-core (Hubble UI / Whisker links only) |
| **tracing** | `none`, `tempo` | — | sd-core (MinIO link only) |
| **auth.provider** | `none`, `basicAuth`, `sso` | — | cross-cutting: ingress namespace for every linked UI, sd-core links + Pomerium logout, our katalog overlays |
| **ingress.nginx / .haproxy** | `none`, `single`, `dual` | — | Headlamp ingress class; sd-core link hosts |

---

## Monitoring — `sd-alerts`, `sd-certificates`, sd-core cards

Data path (hardcoded in all three): `monitoring/services/prometheus-k8s:9090`.
`prometheus-k8s` is created by the `prometheus-operated` katalog package —
which is deployed for **both** `prometheus` and `mimir` (the Mimir katalog
includes `prometheus-operated` as a base; see
`modules/monitoring/katalog/mimir/kustomization.yaml`). It is **not** deployed
for `prometheusAgent`.

| Choice | Status | Behavior / risk |
|---|---|---|
| `none` | ✅ | Features detect "not enabled" and hide gracefully. |
| `prometheus` | ✅ | Verified live: `prometheus-k8s:9090` present; `/api/v1/rules`, `x509_cert_not_after` work. |
| `mimir` | ✅ | Mimir keeps a full, queryable `prometheus-operated` (`prometheus-k8s:9090`) that also `remoteWrite`s to Mimir. Plugins read that local Prometheus, so `/api/v1/rules` and `x509_cert_not_after` work — same as `prometheus`. Plugins do **not** read Mimir, so they see the local Prometheus's data scope (recent + current gauges + all rules), not Mimir's long-term/HA view — acceptable for their use cases. Heavy stack; may not converge on a small Kind dev cluster (environment limit, not a plugin gap). |
| `prometheusAgent` | ❌ | Agent mode deploys only a `PrometheusAgent` (scrape + `remoteWrite`); no `prometheus-operated`, so no `prometheus-k8s:9090` and no query/rules API → alerts/certs **fail**. **Real gap** (plugins accept the type but the endpoint doesn't exist). |

> **Real gap — `prometheusAgent` only:** the accepted set is
> `{prometheus, prometheusAgent, mimir}`, but the hardcoded `prometheus-k8s:9090`
> endpoint exists for `prometheus` and `mimir`, **not** `prometheusAgent`. See
> `sd-alerts/src/AlertsPage.tsx:146-148`, `sd-certificates/src/CertificatesPage.tsx:41`,
> and the `PROM_PREFIX` constants. (Earlier revisions of this doc listed `mimir`
> as a gap; that was incorrect — Mimir keeps `prometheus-operated`.)

---

## Logging — `sd-events`, `sd-logs`, `sd-loki-links`

Backend chosen by `logging.type`; services `logging/services/loki-stack:3100` (Loki, from
`loki-distributed/deploy.yaml` + the Grafana datasource) or
`logging/services/opensearch-cluster-master:9200` (OpenSearch, from `opensearch-single`).

| Choice | sd-events | sd-logs | sd-loki-links | Notes |
|---|---|---|---|---|
| `none` | ✅ hidden | ✅ hidden | ✅ hidden | Graceful. |
| `loki` | ✅ | ✅ | ✅ | Full support; "View logs in Grafana" button present. `loki-stack:3100` exists. |
| `opensearch` | ✅ | ✅ | ✅ | "View logs in OpenSearch" button deep-links to OSD Discover. Index pattern picked from the namespace (`infra` for the 13 namespaces in the infra ClusterFlow, `ingress-controller` for nginx controller pods, else `kubernetes`). Depends on `index-patterns-cronjob` having run — see note below. sd-core also shows the OpenSearch Dashboards link. |
| `customOutputs` | ❌ | ❌ | ❌ | Deploys only `logging-operator`/`logging-operated` routing — **no `loki-stack`, no `opensearch`, no minio**. Plugins branch only on `loki`/`opensearch` → `isLoki=false && isOpensearch=false` → **empty page, no "backend not viewable" message**. **Real gap.** |
| opensearch `single` | ✅ | ✅ | — | Service `opensearch-cluster-master` (verified). |
| opensearch `triple` | ✅ | ✅ | — | `opensearch-triple/kustomization.yaml` bases on `../opensearch-single` and only scales the StatefulSet to 3, so the **same** `opensearch-cluster-master:9200` Service exists → behaves identically to single. |

### Known limitation: the OSD button before index patterns exist

The OSD deep link references index patterns by their saved-object ID (`kubernetes`, `infra`,
`ingress-controller`), which are fixed in
`katalog/opensearch-dashboards/configs/index-patterns.ndjson` and imported by
`index-patterns-cronjob`. That CronJob runs **hourly** (`schedule: "0 * * * *"`), so on a
freshly installed cluster there is a window in which the patterns do not exist yet.

Clicking the button in that window lands on a Discover page showing
`SavedObjectNotFound: Could not locate that index-pattern`, with a link to create it. No
search runs. This is accepted rather than guarded: the plugin would have to query OSD's
saved-objects API on every page view (needing a `services/proxy` grant for
`opensearch-dashboards:5601`) to detect it, and there are no logs worth viewing that early
anyway. To fix it immediately:

```bash
kubectl create job -n logging --from cronjob/index-patterns-cronjob manual-indexes
```

> ℹ️ **The dev environment does not wait for the hour.** This limitation is about a real
> install; our own clusters side-step it. `mise run up` ends by running
> `dev/kind/scripts/seed-opensearch-index-patterns.sh`, which creates a Job from the CronJob's
> own template, waits for it, and asserts the `kubernetes` saved object landed — a no-op on
> non-opensearch flavors. Standalone: `mise run opensearch-index-patterns`.
>
> That is what makes the OpenSearch query formulation testable at all: without the patterns
> Discover never issues a search, so `tests/e2e/checks-logging.sh` asserts the pattern exists
> as a hard **`must`** (read from the OpenSearch side via the `opensearch-cluster-master:9200`
> proxy the tenant already has — OSD's own API on `:5601` is deliberately not granted).

---

## Policy — `sd-policy`, sd-core policy card

| Choice | Status | Behavior |
|---|---|---|
| `none` | ✅ | Hidden. |
| `kyverno` | ✅ | `PolicyReport` + `ClusterPolicyReport` listed; card shows "Fail". |
| `gatekeeper` | ✅ | Runtime discovery of `constraints.gatekeeper.sh` + `status.violations`; card shows "Deny". ⚠️ per-constraint list failures are swallowed silently (partial data risk) — see `gatekeeperClient.ts`. |

---

## DR — `sd-backups`, sd-core backups card

| Choice | Status | Behavior |
|---|---|---|
| `none` | ✅ | Hidden ("DR not enabled"). |
| `on-premises` | ✅ | Velero `Backup`/`Schedule`/`Restore` in `kube-system`. ⚠️ Velero CRDs assumed present; no explicit CRD-absent message. |

*(EKS `velero`/`eks` variants exist in the EKSCluster kind, not in KFDDistribution.)*

---

## Networking — sd-core Hubble / Whisker links

| Choice | Status | Behavior |
|---|---|---|
| `cilium` | ✅ | Hubble UI useful-link shown. |
| `calico` | ✅ | Whisker useful-link shown (ingress `whisker`, `calico-system` ns when not behind SSO). No Hubble link (Hubble is Cilium-specific). |
| `none` | ➖ | No dependency. |

---

## Auth provider — cross-cutting (affects every linked UI)

`auth.provider.type` decides **where infra ingresses live** and how Headlamp is fronted.
Plugins carry SSO/non-SSO branches (e.g. `sd-core/src/ingressLinks.ts`,
`sd-loki-links/src/hooks.ts:85-86`).

| Choice | Status | Behavior / what to test |
|---|---|---|
| `sso` | ✅ | Ingresses in `pomerium` ns; sd-core reads pomerium-namespace ingresses (falling back to the module namespace for ingresses with `disableAuth`; Gangplank is always in `kube-system`); Pomerium logout active. In `module-utilities`, `examples/oidc-capsule` targets this **with** Capsule (per-tenant isolation) and `examples/oidc-rbac` targets it **without** Capsule (SSO login + plain RBAC, cluster-wide read). |
| `basicAuth` | ⚠️❓ | Ingresses in **module** namespaces; sd-core uses the non-SSO namespace set; Pomerium logout inactive. **Test** that links resolve. Our `examples/basic-auth` is an independent front door. |
| `none` | ⚠️❓ | Similar to `basicAuth` (no SSO front door). **Test** link resolution and Headlamp access model. |

---

## Tracing / Ingress

- **tracing** (`none`, `tempo`): only sd-core consumes it, showing the MinIO link when the ingress exists.
- **ingress** nginx/haproxy `single`/`dual`: Headlamp + example ingresses hardcode
  `ingressClassName: nginx`. ⚠️ On a `haproxy`-only cluster the class must be changed;
  `none` means no ingress (Headlamp needs alternative access). sd-core reads whatever host
  the ingress advertises, so link display is class-agnostic.

---

## Test-tracking sheet (fill in per run)

Combine the flavor with `auth.provider` (each row is a cluster you actually stand up).

| # | monitoring | logging | policy | dr | networking | auth | Deployed | sd-alerts | sd-certs | sd-events | sd-logs | sd-loki-links | sd-policy | sd-backups | sd-core | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | prometheus | loki | kyverno | on-premises | cilium | sso | ✅ (dev default) | ✅ | ✅ | | | ✅ | | | | current dev cluster |
| 2 | prometheus | opensearch | gatekeeper | on-premises | cilium | sso | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (by design) |  | ✅ | ✅ | validates OpenSearch path + gatekeeper |
| 3 | mimir | loki | kyverno | on-premises | cilium | sso | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - |
| 4 | prometheusAgent | customOutputs | none | none | cilium | basicAuth | ❓ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ hidden | ✅ hidden | | agent has no queryable Prometheus (real gap) + non-SSO |

---

## Priority items flagged by this matrix

1. **Monitoring endpoint vs `prometheusAgent`** — the accepted set is
   `{prometheus, prometheusAgent, mimir}` and the code always hits `prometheus-k8s:9090`.
   That endpoint exists for `prometheus` and `mimir` (Mimir bundles `prometheus-operated`),
   but **not** for `prometheusAgent` (agent has no query/rules API). Either drop
   `prometheusAgent` from the accepted set or surface an explicit "no queryable Prometheus"
   state for it.
2. **`logging: customOutputs`** — unsupported and silent in sd-events/sd-logs; add an
   explicit "backend not viewable" state.
3. **OpenSearch `triple`** — resolved: `opensearch-triple` bases on `opensearch-single`, so
   `opensearch-cluster-master:9200` resolves identically. No plugin change needed.
4. **Non-SSO (`basicAuth`/`none`)** — exercise the non-SSO ingress-namespace branches end
   to end; they are largely untested today.
5. **Gatekeeper partial failures / Velero CRD absence** — silent; consider surfacing.
