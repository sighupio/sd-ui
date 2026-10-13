#!/usr/bin/env bash
# Single Capsule-detection signal for the APPLY path. Echoes "true" if the furyctl
# config that `mise run up` applies installs Capsule, else "false".
#
# Used by startup.sh, create-cluster.sh, generate-templates.sh and deploy-demo-apps.sh. The
# Tiltfile does the equivalent inline via read_file(). Detection is from the file (not an
# env var) on purpose: dev/kind/furyctl.yaml is the single source of truth for the apply
# path, and an env-var default in env.sh would be clobbered by mise's [env] anyway.
#
# Does not source env.sh: it must work without host-ip.txt.
set -euo pipefail

config="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/furyctl.yaml"
if grep -q 'projectcapsule/capsule' "$config" 2>/dev/null; then
  echo true
else
  echo false
fi
