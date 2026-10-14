#!/usr/bin/env bash
# Force the OpenSearch Dashboards index patterns to exist right after bootstrap.
#
# The logging module ships index-patterns-cronjob with `schedule: "0 * * * *"`. Kubernetes
# CronJobs never fire on creation, so a freshly installed cluster has NO index patterns
# until the next top of the hour — and until then every OSD Discover deep link (the
# sd-loki-links "View logs in OpenSearch" button) lands on "SavedObjectNotFound".
#
# That made the e2e check non-deterministic: whether the OpenSearch query formulation could
# be validated at all depended on what time the cluster happened to be created. Running the
# CronJob's own Job template here removes the wait, so tests are repeatable.
#
# No-op unless modules.logging.type is `opensearch`. Idempotent: safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../env.sh
source "$SCRIPT_DIR/../env.sh"

NS=logging
CRONJOB=index-patterns-cronjob
JOB=index-patterns-bootstrap
# The saved-object ID is fixed in the module's index-patterns.ndjson, so it can be asserted
# directly. See plugins/sd-loki-links/src/openSearchUrl.ts.
PATTERN_DOC=".kibana/_doc/index-pattern:kubernetes"

LOGGING_TYPE="$("$SCRIPT_DIR/detect-logging-type.sh")"

if [ "$LOGGING_TYPE" != "opensearch" ]; then
  echo "[INFO] logging.type is '${LOGGING_TYPE:-<unset>}' — no OpenSearch index patterns to seed."
  exit 0
fi

echo "[INFO] logging.type is opensearch — seeding OSD index patterns from $CRONJOB..."

# The logging module may still be reconciling when this runs.
echo "[INFO] Waiting for $CRONJOB to exist..."
for i in $(seq 1 60); do
  if kubectl -n "$NS" get cronjob "$CRONJOB" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[ERROR] $NS/$CRONJOB not found after 5 minutes — is the logging module installed?" >&2
    exit 1
  fi
  sleep 5
done

# The Job POSTs to opensearch-dashboards:5601, which in turn needs OpenSearch. Waiting for
# both keeps the Job from burning its backoffLimit against a backend that is not up yet.
echo "[INFO] Waiting for OpenSearch and OpenSearch Dashboards to be ready..."
kubectl -n "$NS" rollout status statefulset/opensearch-cluster-master --timeout=10m
kubectl -n "$NS" rollout status deployment/opensearch-dashboards --timeout=10m

# Idempotency: a completed Job of the same name would make `create job` fail.
kubectl -n "$NS" delete job "$JOB" --ignore-not-found --wait=true

echo "[INFO] Creating Job $JOB from $CRONJOB..."
kubectl -n "$NS" create job "$JOB" --from="cronjob/$CRONJOB"

if ! kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=5m; then
  echo "[ERROR] Job $JOB did not complete. Logs:" >&2
  kubectl -n "$NS" logs "job/$JOB" --tail=50 >&2 || true
  exit 1
fi

# The Job's curl exits 0 even when the import API rejects the payload, so assert the saved
# object really landed. Read it through the API-server service proxy — the same path the
# e2e harness uses (tests/e2e/checks-logging.sh).
echo "[INFO] Verifying the 'kubernetes' index pattern exists..."
for i in $(seq 1 12); do
  if kubectl get --raw \
       "/api/v1/namespaces/$NS/services/opensearch-cluster-master:9200/proxy/$PATTERN_DOC" \
       2>/dev/null | grep -q '"found":true'; then
    echo "[SUCCESS] OSD index patterns are in place."
    exit 0
  fi
  sleep 5
done

echo "[ERROR] Job $JOB completed but the 'kubernetes' index pattern is missing." >&2
kubectl -n "$NS" logs "job/$JOB" --tail=50 >&2 || true
exit 1
