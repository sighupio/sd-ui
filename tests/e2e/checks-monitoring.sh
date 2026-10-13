#!/usr/bin/env bash
# ============================================================================
# checks-monitoring.sh — MONITORING category checks (sourced by validate.sh).
#
# Defines checks_monitoring(); uses lib.sh's probe/record/CRIT/RETRIES.
#
# Covers every plugin depending on modules.monitoring.type — all hit the one
# hardcoded service monitoring/services/prometheus-k8s:9090:
#   • sd-alerts / sd-core alerts card -> /proxy/api/v1/rules?type=alert
#   • sd-certificates / sd-core certs -> /proxy/api/v1/query?query=x509_cert_not_after
#   • sd-prometheus-autoconfig        -> premise: /-/healthy
#
# Expected per flavor (see docs/SD_COMPATIBILITY.md):
#   none            -> hidden; prometheus-k8s:9090 absent
#   prometheus      -> works (baseline)
#   mimir           -> works too — the Mimir katalog bundles prometheus-operated,
#                      so a queryable prometheus-k8s:9090 remains (also remote-
#                      writes to Mimir). Plugins read the local Prometheus.
#   prometheusAgent -> agent mode: no prometheus-operated, no query/rules API -> XFAIL
# ============================================================================

_MON_PREFIX="/api/v1/namespaces/monitoring/services/prometheus-k8s:9090/proxy"
_MON_RULES="${_MON_PREFIX}/api/v1/rules?type=alert"
_MON_X509="${_MON_PREFIX}/api/v1/query?query=x509_cert_not_after"
_MON_HEALTH="${_MON_PREFIX}/-/healthy"

# connectivity: 200 + valid Prometheus envelope. Retried to absorb the
# post-apply warm-up race (Prometheus serves /query before /rules). Pass a low
# attempt count where failure is expected (xfail / absence) to stay fast.
_prom_connectivity() { # <path> [attempts=RETRIES]
  local path="$1" attempts="${2:-$RETRIES}" i
  for ((i=1; i<=attempts; i++)); do
    probe "$path"
    if [ "$PROBE_STATUS" = "200" ] && jq -e '.status=="success"' < "$PROBE_BODY_FILE" >/dev/null 2>&1; then
      CRIT=ok; return
    fi
    [ "$i" -lt "$attempts" ] && sleep "$RETRY_SLEEP"
  done
  CRIT=notok
}

_prom_has_data() { # <path> <jq-count-filter>
  local path="$1" filter="$2" i n
  CRIT=notok
  for ((i=1; i<=RETRIES; i++)); do
    probe "$path"
    if [ "$PROBE_STATUS" = "200" ]; then
      n="$(jq -r "$filter" < "$PROBE_BODY_FILE" 2>/dev/null || echo 0)"
      if [ "${n:-0}" -gt 0 ] 2>/dev/null; then CRIT=ok; return; fi
    fi
    [ "$i" -lt "$RETRIES" ] && sleep "$RETRY_SLEEP"
  done
}

_prom_health() { # [attempts=RETRIES]
  local attempts="${1:-$RETRIES}" i
  for ((i=1; i<=attempts; i++)); do
    probe "$_MON_HEALTH"
    [ "$PROBE_STATUS" = "200" ] && { CRIT=ok; return; }
    [ "$i" -lt "$attempts" ] && sleep "$RETRY_SLEEP"
  done
  CRIT=notok
}

checks_monitoring() {
  local detected expected flavor ok
  detected="$(config_module_type monitoring)"
  expected="${EXPECTED_MONITORING_TYPE:-}"

  if [ -n "$expected" ]; then
    flavor="$expected"
    [ "$detected" = "$expected" ] && ok=ok || ok=notok
    record "monitoring: detect type (=$expected)" "$ok" must "sd-spec reports '${detected:-<empty>}'"
  else
    flavor="${detected:-none}"
    echo "[info] monitoring: live flavor '${flavor}'"
  fi

  case "$flavor" in
    none)
      _prom_health 1; [ "$CRIT" = "ok" ] && ok=notok || ok=ok
      record "monitoring: sd-* hidden (prom-k8s absent)"  "$ok"   must  "health probe HTTP $PROBE_STATUS"
      ;;
    prometheus|mimir)
      # mimir keeps a queryable prometheus-operated (prometheus-k8s:9090).
      _prom_connectivity "$_MON_RULES"
      record "monitoring: sd-alerts rules reachable"      "$CRIT" must  "HTTP $PROBE_STATUS"
      _prom_has_data "$_MON_RULES" '[.data.groups[].rules[]?]|length'
      record "monitoring: sd-alerts+core rules present"   "$CRIT" must  "HTTP $PROBE_STATUS, grouped alerting rules"
      _prom_connectivity "$_MON_X509"
      record "monitoring: sd-certs query reachable"       "$CRIT" must  "HTTP $PROBE_STATUS"
      _prom_has_data "$_MON_X509" '.data.result|length'
      record "monitoring: sd-certs x509 series present"   "$CRIT" must  "HTTP $PROBE_STATUS, cert-expiry series"
      _prom_health
      record "monitoring: autoconfig /-/healthy 200"      "$CRIT" must  "HTTP $PROBE_STATUS"
      ;;
    prometheusAgent)
      # Agent mode: no prometheus-operated -> no queryable prometheus-k8s:9090.
      _prom_connectivity "$_MON_RULES" 1
      record "monitoring: sd-alerts rules reachable"      "$CRIT" xfail "HTTP $PROBE_STATUS (agent has no query/rules API)"
      _prom_connectivity "$_MON_X509" 1
      record "monitoring: sd-certs query reachable"       "$CRIT" xfail "HTTP $PROBE_STATUS (agent has no query API)"
      _prom_health 1
      record "monitoring: autoconfig /-/healthy 200"      "$CRIT" xfail "HTTP $PROBE_STATUS (prometheus-k8s:9090 absent)"
      ;;
    *)
      record "monitoring: unknown flavor '$flavor'"       notok  must  "unhandled monitoring.type"
      ;;
  esac
}
