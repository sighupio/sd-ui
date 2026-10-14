#!/usr/bin/env bash
# ============================================================================
# checks-logging.sh — LOGGING category checks (sourced by validate.sh).
#
# Defines checks_logging(); uses lib.sh's probe/record/CRIT/RETRIES.
#
# Plugins depending on modules.logging.type (detected as isLoki/isOpensearch):
#   • sd-events -> loki-stack:3100/proxy/loki/api/v1/query_range
#                  OR opensearch-cluster-master:9200/proxy/events-*/_search
#   • sd-logs   -> loki-stack:3100/proxy/loki/api/v1/{query_range,label/…/values}
#                  OR opensearch-cluster-master:9200/proxy/kubernetes-*,infra-*/_search
#   • sd-loki-links -> Grafana button (loki) OR OSD Discover button (opensearch)
#                      (frontend; not curl-testable here — the ingress it needs is asserted)
#   • sd-core       -> OpenSearch Dashboards ingress link, opensearch ONLY
#
# Backend services are curl-tested exactly as the plugins call them (GET for
# Loki, POST _search for OpenSearch). Frontend button/link RENDERING is out of
# curl scope and is only noted, not asserted.
#
# Expected per flavor (see docs/SD_COMPATIBILITY.md):
#   none          -> hidden; no backend reachable
#   loki          -> loki-stack:3100 works (loki-distributed exposes it)
#   opensearch    -> opensearch-cluster-master:9200 works (single AND triple —
#                    triple bases on single, same Service); + OSD ingress present
#                    + OSD index patterns imported (sd-loki-links deep link) —
#                      `up` seeds them, so this is asserted, not tolerated
#   customOutputs -> no queryable backend at all (only logging-operator routing)
#                    -> XFAIL (plugins go blind, silently). Not auto-provisioned.
# ============================================================================

_LOKI_PREFIX="/api/v1/namespaces/logging/services/loki-stack:3100/proxy"
_LOKI_LABELS="${_LOKI_PREFIX}/loki/api/v1/labels"
_LOKI_NS_VALUES="${_LOKI_PREFIX}/loki/api/v1/label/namespace/values"
_OS_PREFIX="/api/v1/namespaces/logging/services/opensearch-cluster-master:9200/proxy"
_OS_SEARCH="${_OS_PREFIX}/kubernetes-*,infra-*/_search"
# sd-core reads the opensearch-dashboards ingress (pomerium ns under SSO,
# logging ns otherwise). RBAC lets the tenant `get` ingresses cluster-wide.
_OSD_SSO="/apis/networking.k8s.io/v1/namespaces/pomerium/ingresses/opensearch-dashboards"
_OSD_NOSSO="/apis/networking.k8s.io/v1/namespaces/logging/ingresses/opensearch-dashboards"

# Log ingestion (fluentd/fluent-bit -> backend -> index) is far slower to warm
# up than a metric scrape, so data-presence gets a bigger budget than the
# shared connectivity RETRIES. Default ~5 min.
_LOG_DATA_RETRIES="${LOGGING_DATA_RETRIES:-60}"

# Loki connectivity: GET returns {"status":"success",...}
_loki_connectivity() { # [attempts=RETRIES]
  local attempts="${1:-$RETRIES}" i
  for ((i=1; i<=attempts; i++)); do
    probe "$_LOKI_LABELS"
    if [ "$PROBE_STATUS" = "200" ] && jq -e '.status=="success"' < "$PROBE_BODY_FILE" >/dev/null 2>&1; then
      CRIT=ok; return
    fi
    [ "$i" -lt "$attempts" ] && sleep "$RETRY_SLEEP"
  done
  CRIT=notok
}

# Loki data present: namespace label has at least one value (logs are flowing).
_loki_has_data() {
  local i n
  CRIT=notok
  for ((i=1; i<=_LOG_DATA_RETRIES; i++)); do
    probe "$_LOKI_NS_VALUES"
    if [ "$PROBE_STATUS" = "200" ]; then
      n="$(jq -r '.data|length' < "$PROBE_BODY_FILE" 2>/dev/null || echo 0)"
      if [ "${n:-0}" -gt 0 ] 2>/dev/null; then CRIT=ok; return; fi
    fi
    [ "$i" -lt "$_LOG_DATA_RETRIES" ] && sleep "$RETRY_SLEEP"
  done
}

# OpenSearch connectivity: POST _search {"size":0} -> 200 with a hits envelope.
_os_connectivity() { # [attempts=RETRIES]
  local attempts="${1:-$RETRIES}" i
  for ((i=1; i<=attempts; i++)); do
    probe "$_OS_SEARCH" POST '{"size":0}'
    if [ "$PROBE_STATUS" = "200" ] && jq -e 'has("hits")' < "$PROBE_BODY_FILE" >/dev/null 2>&1; then
      CRIT=ok; return
    fi
    [ "$i" -lt "$attempts" ] && sleep "$RETRY_SLEEP"
  done
  CRIT=notok
}

# OpenSearch data present: at least one indexed document.
_os_has_data() {
  local i n
  CRIT=notok
  for ((i=1; i<=_LOG_DATA_RETRIES; i++)); do
    probe "$_OS_SEARCH" POST '{"size":0}'
    if [ "$PROBE_STATUS" = "200" ]; then
      n="$(jq -r '.hits.total.value // 0' < "$PROBE_BODY_FILE" 2>/dev/null || echo 0)"
      if [ "${n:-0}" -gt 0 ] 2>/dev/null; then CRIT=ok; return; fi
    fi
    [ "$i" -lt "$_LOG_DATA_RETRIES" ] && sleep "$RETRY_SLEEP"
  done
}

# sd-loki-links' OSD deep link references index patterns by their fixed saved-object ID
# (kubernetes / infra / ingress-controller, from opensearch-dashboards/configs/
# index-patterns.ndjson). Read the saved object through the opensearch-cluster-master proxy
# the tenant already has — OSD's own API on :5601 is deliberately NOT granted.
_osd_index_patterns() { # [attempts=_LOG_DATA_RETRIES]
  local attempts="${1:-$_LOG_DATA_RETRIES}" i
  CRIT=notok
  for ((i=1; i<=attempts; i++)); do
    probe "${_OS_PREFIX}/.kibana/_doc/index-pattern:kubernetes"
    if [ "$PROBE_STATUS" = "200" ] && jq -e '.found==true' < "$PROBE_BODY_FILE" >/dev/null 2>&1; then
      CRIT=ok; return
    fi
    [ "$i" -lt "$attempts" ] && sleep "$RETRY_SLEEP"
  done
}

# sd-core OpenSearch Dashboards ingress present (SSO ns first, then non-SSO).
_osd_ingress() {
  probe "$_OSD_SSO";   [ "$PROBE_STATUS" = "200" ] && { CRIT=ok; return; }
  probe "$_OSD_NOSSO"; [ "$PROBE_STATUS" = "200" ] && { CRIT=ok; return; }
  CRIT=notok
}

checks_logging() {
  local detected expected flavor ok
  detected="$(config_module_type logging)"
  expected="${EXPECTED_LOGGING_TYPE:-}"

  if [ -n "$expected" ]; then
    flavor="$expected"
    [ "$detected" = "$expected" ] && ok=ok || ok=notok
    record "logging: detect type (=$expected)" "$ok" must "sd-spec reports '${detected:-<empty>}'"
  else
    flavor="${detected:-none}"
    echo "[info] logging: live flavor '${flavor}'"
  fi

  case "$flavor" in
    none)
      # Hidden: neither backend should be reachable.
      _loki_connectivity 1; [ "$CRIT" = "ok" ] && ok=notok || ok=ok
      record "logging: sd-events/logs hidden (loki absent)" "$ok"   must  "loki HTTP $PROBE_STATUS"
      _os_connectivity 1;   [ "$CRIT" = "ok" ] && ok=notok || ok=ok
      record "logging: sd-events/logs hidden (os absent)"   "$ok"   must  "opensearch HTTP $PROBE_STATUS"
      ;;
    loki)
      _loki_connectivity
      record "logging: sd-events/logs loki reachable"       "$CRIT" must  "HTTP $PROBE_STATUS"
      _loki_has_data
      record "logging: sd-logs loki has data"               "$CRIT" must  "HTTP $PROBE_STATUS, namespace labels"
      # sd-loki-links renders its "View logs in Grafana" button here (frontend; not probed).
      ;;
    opensearch)
      _os_connectivity
      record "logging: sd-events/logs opensearch reachable" "$CRIT" must  "HTTP $PROBE_STATUS"
      _os_has_data
      record "logging: sd-logs opensearch has data"         "$CRIT" must  "HTTP $PROBE_STATUS, indexed docs"
      # Same ingress backs sd-core's link and sd-loki-links' "View logs in OpenSearch"
      # button, so this one probe covers both.
      _osd_ingress
      record "logging: sd-core + sd-loki-links OSD ingress" "$CRIT" must  "HTTP $PROBE_STATUS"
      # The OSD button also needs the index patterns; without them Discover reports
      # SavedObjectNotFound. `up` seeds them (dev/kind/scripts/seed-opensearch-index-patterns.sh)
      # instead of waiting out the hourly CronJob, so this is a hard assertion.
      _osd_index_patterns
      record "logging: sd-loki-links OSD index patterns"    "$CRIT" must  "HTTP $PROBE_STATUS"
      ;;
    customOutputs)
      # Only logging-operator routing is deployed; no loki-stack, no opensearch.
      _loki_connectivity 1
      record "logging: sd-events/logs loki reachable"       "$CRIT" xfail "HTTP $PROBE_STATUS (customOutputs has no loki)"
      _os_connectivity 1
      record "logging: sd-events/logs opensearch reachable" "$CRIT" xfail "HTTP $PROBE_STATUS (customOutputs has no opensearch)"
      ;;
    *)
      record "logging: unknown flavor '$flavor'"            notok  must  "unhandled logging.type"
      ;;
  esac
}
