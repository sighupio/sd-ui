# SD-UI compatibility validation

Programmatic checks that the Headlamp plugins work against each SD module
_flavor_ (e.g. `prometheus` vs `mimir`, `loki` vs `opensearch`). Each check
reproduces, over `curl`, the exact HTTP a plugin makes at runtime: log in as a
Capsule tenant user (Dex/OIDC) and call the Capsule Proxy with a Bearer
id-token.

**Covered today: `monitoring`, `logging`, `policy`.** More categories follow the same shape.

## Philosophy: fresh install per scenario

A *scenario* is a set of module flavors (monitoring + logging + …). Each scenario
is validated against a **freshly installed** cluster, so results are never
contaminated by an in-place flavor switch.

Provisioning renders the whole scenario `furyctl.yaml` (clean, comment-free) and
compares it — a real file diff — to the committed `dev/kind/furyctl.yaml`, the
config the running cluster is assumed to use:

- **identical** → reuse the running cluster (or `mise run up` if none is running);
- **different** → overwrite `dev/kind/furyctl.yaml`, tear down any running cluster
  (gated by `APPROVE_DOWN=1` or an interactive `y/N`), then `mise run up`.

`dev/kind/furyctl.yaml` is itself the default render of `dev/kind/furyctl.yaml.tmpl`
(prometheus / loki / single) and is committed.

After the cluster is up, provisioning also **deploys Headlamp** the same way
`mise run dev` does but batch-mode (`tilt ci`: build plugins → image → apply the
dev overlay). Skip with `SKIP_HEADLAMP=1`.

**Transport (`PROBE_MODE`, default `headlamp`).** Validation drives the *full*
runtime path — Pomerium (a `_pomerium` session obtained via `pomerium-login.sh`)
→ Headlamp (`/clusters/main`) → Capsule Proxy — so a probe is exactly what the
plugin issues in the browser. `PROBE_MODE=direct` instead calls the Capsule
Proxy with the tenant id-token (Headlamp-independent; faster backend-only check).

**Why a separate Pomerium login, when `capsule-login.sh` already gets a valid
id-token?** Because in `headlamp` mode the front door is *Pomerium*, and the
id-token doesn't get us through it:

- Pomerium's route requires an authenticated **Pomerium session** (`authenticated_user: true`);
  a request without the `_pomerium` cookie is 302-redirected to the sign-in flow,
  regardless of any `Authorization` header it carries.
- Pomerium **overwrites** the upstream `Authorization` header
  (`set_request_headers: Authorization: "Bearer ${pomerium.id_token}"`) — so even
  if we attached our id-token, Pomerium would replace it with the one *it* minted
  after its own login.

So `pomerium-login.sh` performs Pomerium's cookie-based OIDC dance (Pomerium is a
Dex client; it ends in a `_pomerium` session cookie, not a k8s token) and we reuse
that cookie. The id-token path still applies to `PROBE_MODE=direct`, which bypasses
Pomerium and talks to the Capsule Proxy straight — hence the two separate login
scripts (`pomerium-login.sh` vs `capsule-login.sh`).

## Capsule-free scenario (`CAPSULE=false`)

The same modules can be provisioned **without Capsule** — SSO + OIDC pass-through
straight to the API server, with plain RBAC (no tenant isolation). This mirrors a
cluster that has an IdP + SSO but no Capsule.

**How the flavor is chosen.** `CAPSULE` (`true`/`false`) drives the whole workflow —
Capsule-CA sync, `users.ldif` group, demo-apps path, Headlamp overlay — but it is
set two different ways:

- **`mise run up`** never renders: it applies `dev/kind/furyctl.yaml` as-is and
  **auto-detects** `CAPSULE` from that file (`env.sh` looks for the Capsule Helm
  chart). To run a no-Capsule cluster manually you edit `furyctl.yaml` yourself
  (drop the Capsule Helm release + `capsule-rbac`/`tenants`/`capsule-proxy-ingress`,
  add the `oidc-rbac` plugin) — use the render below as the reference for that shape.
- **The test harness** sets `CAPSULE` explicitly and *renders* the scenario:
  `render_furyctl` strips the `#<capsule-only>` / `#<no-capsule-only>` marker blocks
  in `dev/kind/furyctl.yaml.tmpl` to produce the no-Capsule `furyctl.yaml`. This is the
  **only** place the file is generated — `up` never touches the template.
  The same mechanism drops `#<monitoring-only>` blocks (patches targeting resources the
  monitoring module deploys) when `MONITORING_TYPE=none`.

In the no-Capsule flavor:

- the LDAP group is `sd-ui-users` (not `capsule.clastix.io`) — nothing
  Capsule-flavored is present, including in the token's `groups` claim
  (`SD_LDAP_GROUP`, rendered into `users.ldif`);
- the `oidc-rbac` plugin grants **cluster-wide read** to that group (no per-namespace
  list filter exists without Capsule Proxy) — an ops/SRE-scope grant, not isolation;
- Headlamp talks to the real API server: Tilt deploys `dev/kind/tilt/headlamp-no-capsule`
  (the module-utilities katalog base + Pomerium ingress, **without** the Capsule-redirect patch); the
  Capsule-CA sync is skipped;
- demo apps deploy as admin into plain namespaces.

Validation is **unchanged**: `PROBE_MODE=headlamp` drives Pomerium → Headlamp →
(API server here, Capsule Proxy in the Capsule scenario), so the category checks
are backend-agnostic and reused as-is.

```bash
mise run "test:scenario-no-capsule"   # render (CAPSULE=false) + provision + validate
```

## Prerequisites

- `curl`, `jq`, `python3`, `kubectl`, `envsubst`, `furyctl` (all via `mise install`).
- A machine able to run the dev cluster (`host-ip.txt`, Docker, mise) — see the root README.

Run from the repo root:

```bash
mise run "test:validate"                                        # assert live cluster (read-only)
MONITORING_TYPE=mimir LOGGING_TYPE=opensearch mise run "test:scenario"   # provision + validate
APPROVE_DOWN=1 MONITORING_TYPE=prometheusAgent mise run "test:scenario"  # recreate a running cluster
```

## Tasks

| Task | What it does |
|---|---|
| `test:provision` | Ensures a **fresh** cluster for the scenario (reuses a matching one; teardown needs `APPROVE_DOWN=1`). The single provision entrypoint for every category. |
| `test:validate` | Curl-probes the live cluster for all categories and prints one aggregated report. Read-only. |
| `test:scenario` | `provision` + `validate` for one scenario. |
| `test:scenario-no-capsule` | `test:scenario` with `CAPSULE=false` + `PROBE_MODE=headlamp` — the Capsule-free scenario end-to-end. |

### Environment variables

| Var | Used by | Values / default |
|---|---|---|
| `MONITORING_TYPE` | provision, scenario | `none` \| `prometheus` \| `prometheusAgent` \| `mimir` (default `prometheus`) |
| `LOGGING_TYPE` | provision, scenario | `none` \| `loki` \| `opensearch` (default `loki`). `customOutputs` is not provisionable — static-only gap. |
| `LOGGING_OPENSEARCH_TYPE` | provision, scenario | `single` \| `triple` (default `single`) |
| `POLICY_TYPE` | provision, scenario | `none` \| `kyverno` \| `gatekeeper` (default `kyverno`) |
| `CAPSULE` | provision, scenario | `true` (default) \| `false`. `false` = Capsule-free (SSO + OIDC pass-through to the API server, no tenant isolation); use with `PROBE_MODE=headlamp`. **Test-harness input only** — `mise run up`/`dev` ignore it and auto-detect from `dev/kind/furyctl.yaml`. |
| `APPROVE_DOWN=1` | provision, scenario | Allow tearing down a running, non-matching cluster (else prompt on a TTY, or refuse). |
| `SKIP_HEADLAMP=1` | provision, scenario | Skip the `tilt ci` Headlamp deploy step. |
| `PROBE_MODE` | validate | `headlamp` (default, through Pomerium→Headlamp) or `direct` (Capsule Proxy + id-token). |
| `LOGGING_DATA_RETRIES` | validate | Retry budget for logging *data-presence* only (log ingest is slow). Default `60` × `RETRY_SLEEP`. |
| `CATEGORIES` | validate | Subset of categories to check. Default: **all** sourced categories (auto-discovered — today `monitoring logging policy`). |
| `EXPECTED_<CAT>_TYPE` | validate | e.g. `EXPECTED_MONITORING_TYPE` — assert the live flavor matches (detection layer). |
| `CAPSULE_USER` / `CAPSULE_PASS` | all | Tenant login. Default `alice` / `alice`. |
| `SKIP_LOGIN=1` | validate | Reuse the existing token instead of re-running the OIDC login. |
| `RETRIES` / `RETRY_SLEEP` | validate | Retry budget for connectivity + data-presence checks (warm-up). Default `12` × `5s`. Expected-fail (xfail) and absence checks use a single attempt. |

## Reading the output

Each row is one plugin capability. Verdicts:

| Verdict | Meaning | Exit impact |
|---|---|---|
| `PASS` | Expected to work, and does. | ok |
| `FAIL` | Expected to work, but doesn't. | **non-zero** |
| `XFAIL` | Known gap; expected to fail today (documented in `../../docs/SD_COMPATIBILITY.md`). | ok |
| `XPASS` | A known gap now works — **update the compatibility matrix**. | **non-zero** |

The run exits non-zero on any `FAIL` or `XPASS`, so it is CI/e2e-ready.

> **On the opensearch flavor, `up` seeds the OSD index patterns.** They are created by
> `index-patterns-cronjob`, which fires hourly and never on creation, so whether the OSD
> Discover deep links worked used to depend on what time the cluster was built — and with
> them missing there is no way to validate the OpenSearch query formulation at all.
> `dev/kind/scripts/seed-opensearch-index-patterns.sh` runs the CronJob's Job template during
> bootstrap, so `logging: sd-loki-links OSD index patterns` is a hard assertion rather than
> a tolerated gap. Re-run it standalone with `mise run opensearch-index-patterns`.

> Backend data paths are curl-testable. Pure-frontend behavior (the sd-loki-links
> "View logs in Grafana"/"View logs in OpenSearch" button, sd-core landing links) is
> **not** curl-tested; where relevant the harness asserts what the frontend depends on
> (the `opensearch-dashboards` ingress, and the OSD index patterns the deep link
> references) and notes the rest.

## Files

- `tasks.toml` — mise task definitions (included from the root `mise.toml`).
- `lib.sh` — shared helpers: token acquisition, `probe`, `render_furyctl`, `provision_cluster`, flavor detection, `record`/`summary`.
- `validate.sh` — runner: logs in once, runs each `checks_<category>`, one aggregated summary.
- `checks-monitoring.sh` / `checks-logging.sh` / `checks-policy.sh` — per-category `checks_<cat>()` with the flavor expectation tables.
- `../../dev/kind/furyctl.yaml.tmpl` — superset furyctl config; `envsubst` switches only the `${…_TYPE}` vars, header stripped on render.
- `../../dev/kind/scripts/pomerium-login.sh` — obtains the `_pomerium` session cookie (headlamp mode), the sibling of `capsule-login.sh` (direct mode).

## Generated files (secrets — gitignored)

The login scripts write per-user secrets into `dev/kind/state/capsule-user/`:

| File | Written by | What it is |
|---|---|---|
| `kubeconfig` | `capsule-login.sh` (direct mode) | kubeconfig embedding the tenant OIDC **id-token** |
| `pomerium-cookies.txt` | `pomerium-login.sh` (headlamp mode) | the `_pomerium` **session cookie** jar |
| `login.html` | `pomerium-login.sh` with `DEBUG=1` | dump of the Dex form (debugging only) |

The whole `dev/kind/state/capsule-user/` directory is **gitignored** — never commit it. The
scripts `mkdir -p` it on demand, so it needs no tracked placeholder.

## Adding a category

Create `checks-<category>.sh` defining `checks_<category>()` (reuse `lib.sh`'s
`probe`/`record`/`config_module_type`), `source` it in `validate.sh`, and — if
the category needs a new `type` knob — add a `${…_TYPE}` variable to the
template and to `render_furyctl`'s allow-list. No new task is needed.
