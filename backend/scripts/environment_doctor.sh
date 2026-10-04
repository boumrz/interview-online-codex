#!/usr/bin/env bash
# A caller may enable tracing; never trace the account token or request header.
set +x
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"

if [[ -z "${INTERHUB_AUTH_TOKEN:-}" ]]; then
  echo "INTERHUB_AUTH_TOKEN is required for the authenticated Environment Doctor API." >&2
  exit 1
fi

if [[ "$INTERHUB_AUTH_TOKEN" == *$'\n'* || "$INTERHUB_AUTH_TOKEN" == *$'\r'* ]]; then
  echo "INTERHUB_AUTH_TOKEN must not contain line breaks." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

# Read the header from stdin so credentials never enter curl's process arguments.
if ! RAW_RESPONSE="$(printf 'Authorization: Bearer %s\n' "$INTERHUB_AUTH_TOKEN" \
  | curl -q -fsS --header @- -- "${BASE_URL%/}/api/agent/environment/doctor")"; then
  echo "Environment Doctor request failed." >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  if ! STATUS="$(printf '%s\n' "$RAW_RESPONSE" | jq -ser '
    if length == 1 and (.[0] | type) == "object" and (.[0].status | type) == "string"
    then .[0].status else error("invalid report") end
  ' 2>/dev/null)"; then
    echo "Environment Doctor returned an invalid JSON report or missing status." >&2
    exit 2
  fi
elif command -v node >/dev/null 2>&1; then
  if ! STATUS="$(printf '%s\n' "$RAW_RESPONSE" | node --input-type=module -e '
    import { readFileSync } from "node:fs";
    try {
      const report = JSON.parse(readFileSync(0, "utf8"));
      if (typeof report?.status !== "string") process.exit(2);
      process.stdout.write(report.status);
    } catch { process.exit(2); }
  ')"; then
    echo "Environment Doctor returned an invalid JSON report or missing status." >&2
    exit 2
  fi
else
  echo "jq or Node.js is required to validate the Environment Doctor JSON report." >&2
  exit 1
fi

case "$STATUS" in
  PASS|WARN|FAIL) ;;
  *)
    echo "Environment Doctor returned an unknown status." >&2
    exit 2
    ;;
esac

if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$RAW_RESPONSE" | jq .
else
  printf '%s\n' "$RAW_RESPONSE"
fi

if [[ "$STATUS" == "FAIL" ]]; then
  echo "Environment Doctor reported FAIL" >&2
  exit 2
fi

echo "Environment Doctor status: $STATUS"
