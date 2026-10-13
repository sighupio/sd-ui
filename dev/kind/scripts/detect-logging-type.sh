#!/usr/bin/env bash
# Single logging-flavor signal for the APPLY path. Echoes modules.logging.type from the
# furyctl config that `mise run up` applies ("loki", "opensearch", "customOutputs",
# "none"), or the empty string if it cannot be determined.
#
# Same rationale as detect-capsule.sh: read it from the file, because dev/kind/furyctl.yaml
# is the single source of truth for the apply path and an env-var default in env.sh would
# be clobbered by mise's [env] anyway.
#
# Only the DIRECT child `type:` of `logging:` counts — `logging.opensearch.type`
# (single|triple) is a nested sub-block and must not be mistaken for the flavor.
#
# Does not source env.sh: it must work without host-ip.txt.
set -euo pipefail

config="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/furyctl.yaml"

python3 - "$config" <<'PY'
import sys

path = sys.argv[1]
try:
    lines = open(path).read().splitlines()
except OSError:
    print("")
    sys.exit(0)

mod_indent = None    # indent of the "logging:" line
child_indent = None  # indent of its direct children

for line in lines:
    if not line.strip() or line.lstrip().startswith("#"):
        continue

    stripped = line.lstrip()
    indent = len(line) - len(stripped)

    if mod_indent is not None:
        if indent > mod_indent:
            if child_indent is None:
                child_indent = indent
            if indent == child_indent and stripped.startswith("type:"):
                print(stripped.split(":", 1)[1].strip().strip("\"'"))
                sys.exit(0)
            continue
        # Dedented back out of the logging block without finding a type.
        break

    if stripped.startswith("logging:"):
        mod_indent = indent

print("")
PY
