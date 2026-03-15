#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"

if command -v curl >/dev/null 2>&1; then
  RAW_RESPONSE="$(curl -fsS "${BASE_URL}/api/agent/environment/doctor")"
else
  echo "curl is required"
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  echo "$RAW_RESPONSE" | jq .
  STATUS="$(echo "$RAW_RESPONSE" | jq -r '.status')"
else
  echo "$RAW_RESPONSE"
  STATUS="$(echo "$RAW_RESPONSE" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([A-Z]*\)".*/\1/p' | head -n1)"
fi

if [[ "$STATUS" == "FAIL" ]]; then
  echo "Environment Doctor reported FAIL"
  exit 2
fi

echo "Environment Doctor status: ${STATUS:-UNKNOWN}"
