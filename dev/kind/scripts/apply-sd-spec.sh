#!/usr/bin/env bash
# Apply the headlamp/sd-spec ConfigMap the SD plugins read, rendered from dev/kind/furyctl.yaml.
#
# The distribution renders it (templates/distribution/manifests/utilities/resources/
# sd-spec.yml.tpl) only together with its own Headlamp, i.e. on OnPremises/Immutable. On Kind
# Headlamp comes from Tilt, so without this the plugins see no modules at all. The fields and
# defaults mirror that template: keep the two in sync.
#
# moduleVersions comes from kfd.yaml, read from FURYCTL_DISTRO_LOCATION when set; otherwise it
# is empty, as the distribution renders it on a furyctl without `.kfd`.
# With Capsule it also lets the tenant users read it. Idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

# Run each tool, not just look it up: an x86_64 binary without Rosetta is on the PATH but
# cannot start.
for probe in "kubectl version --client" "jq --version" "yq --version"; do
  if ! $probe >/dev/null 2>&1; then
    echo "[ERROR] '${probe%% *}' not found or not runnable. Run 'mise install' first." >&2
    exit 1
  fi
done

CONFIG_JSON="$(yq -o=json '.' "$KIND_FURYCTL_CONFIG")"
KFD_JSON='{}'
if [ -n "${FURYCTL_DISTRO_LOCATION:-}" ] && [ -f "$FURYCTL_DISTRO_LOCATION/kfd.yaml" ]; then
  KFD_JSON="$(yq -o=json '.' "$FURYCTL_DISTRO_LOCATION/kfd.yaml")"
fi

# Modules selected by a top-level `type`: when the chosen type has its own `type`
# (e.g. logging.opensearch.type: single) it is reported too.
INFO_JSON="$(jq -n --argjson cfg "$CONFIG_JSON" --argjson kfd "$KFD_JSON" '
  ($cfg.spec.distribution.modules // {}) as $m
  | def str(v): v // "none" | tostring;
  # furyctl resolves {env://VAR} at apply time: do the same for the hosts
  def resolve: if type == "string" and test("^\\{env://.+\\}$") then $ENV[.[7:-1]] // "" else . end;
  # Override host, otherwise prefix + base domain (auth links use the auth base domain)
  def link($mod; $pkg; $prefix; $name):
    (($m[$mod].overrides.ingresses[$pkg].host // "") | resolve) as $host
    | (if $mod == "auth" then $m.auth.baseDomain else $m.ingress.baseDomain end | resolve) as $base
    | { module: $mod, name: $name, url: ("https://" + (if $host != "" then $host else $prefix + $base end)) };
  # Kind always has a StorageClass, the storageClassAvailable check is always true. Backends
  # default to minio, as in the distribution defaults
  def links($m):
    ((str($m.ingress.nginx.type) != "none") or (str($m.ingress.haproxy.type) != "none")
      or ($m.ingress.byoic.enabled // false)) as $hasAnyIngress
    | [
      if $m.auth.oidcKubernetesAuth.enabled then link("auth"; "gangplank"; "gangplank."; "Gangplank") else empty end,
      if $hasAnyIngress then
        link("ingress"; "forecastle"; "directory."; "Forecastle"),
        (str($m.logging.type) as $t | if $t == "loki" or $t == "opensearch" then
          (if $t == "opensearch" then link("logging"; "opensearchDashboards"; "opensearch-dashboards."; "OpenSearch Dashboards") else empty end),
          link("logging"; "minio"; "minio-logging."; "MinIO")
        else empty end),
        (str($m.monitoring.type) as $t | if $t == "prometheus" or $t == "mimir" then
          link("monitoring"; "grafana"; "grafana."; "Grafana"),
          link("monitoring"; "prometheus"; "prometheus."; "Prometheus"),
          link("monitoring"; "alertmanager"; "alertmanager."; "Alertmanager"),
          (if $t == "mimir" and ($m.monitoring.mimir.backend // "minio") == "minio" then link("monitoring"; "minio"; "minio-monitoring."; "MinIO") else empty end)
        else empty end),
        (str($m.networking.type) as $t
          | if $t == "calico" then link("networking"; "whisker"; "whisker."; "Whisker")
            elif $t == "cilium" then link("networking"; "hubble"; "hubble."; "Hubble UI")
            else empty end),
        (if str($m.policy.type) == "gatekeeper" then link("policy"; "gpm"; "gpm."; "Gatekeeper Policy Manager") else empty end),
        (if str($m.tracing.type) == "tempo" and ($m.tracing.tempo.backend // "minio") == "minio" then link("tracing"; "minio"; "minio-tracing."; "MinIO") else empty end)
      else empty end
    ];
  {
    distributionVersion: ($kfd.version // $cfg.spec.distributionVersion | tostring),
    cluster: { name: $cfg.metadata.name, kind: $cfg.kind },
    moduleVersions: ($kfd.modules // {} | map_values(tostring)),
    modules: (
      reduce ("dr", "logging", "monitoring", "networking", "policy", "tracing") as $n ({};
        str($m[$n].type) as $t
        | .[$n] = { type: $t }
        | ($m[$n][$t] | if type == "object" then .type else null end) as $sub
        | if $sub then .[$n][$t] = { type: ($sub | tostring) } else . end)
      + {
        auth: { provider: { type: str($m.auth.provider.type) } },
        ingress: {
          nginx: { type: str($m.ingress.nginx.type) },
          haproxy: { type: str($m.ingress.haproxy.type) }
        },
        utilities: { headlamp: { type: str($m.utilities.headlamp.type) } }
      }),
    links: links($m)
  }')"

kubectl create namespace headlamp --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl create configmap sd-spec -n headlamp --from-literal=info.json="$INFO_JSON" \
  --dry-run=client -o yaml | kubectl apply -f -

# Capsule tenant users reach it through the Capsule Proxy, which allows `get` outside the
# tenant only with RBAC: grant exactly this ConfigMap. Without Capsule, the oidc-rbac plugin
# already grants configmaps cluster-wide, like the distribution does.
if [ "$("$SCRIPT_DIR/detect-capsule.sh")" = "true" ]; then
  kubectl create role sd-spec-reader -n headlamp --verb=get \
    --resource=configmaps --resource-name=sd-spec --dry-run=client -o yaml | kubectl apply -f -
  kubectl create rolebinding sd-spec-reader -n headlamp --role=sd-spec-reader \
    --group=capsule.clastix.io --dry-run=client -o yaml | kubectl apply -f -
fi

echo "[SUCCESS] headlamp/sd-spec applied: $(jq -r '.modules | [paths(type == "string") as $p
  | "\($p[:-1] | join("."))=\(getpath($p))"] | join(" ")' <<< "$INFO_JSON")"
