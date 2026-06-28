#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/interview-online}"
REPO_DIR="${REPO_DIR:-${APP_ROOT}/repo}"
ENV_FILE="${ENV_FILE:-/etc/interview-online/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_DIR}/docker-compose.prod.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is not installed."
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "Environment file is missing: ${ENV_FILE}"
  echo "Copy deploy/env/docker.env.example and edit values first."
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "Compose file is missing: ${COMPOSE_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_DIR}/docker-compose.prod.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-${COMPOSE_FILE}}"
DOMAIN="${DOMAIN:-interview.vtools.tech}"
FINANCE_PROXY_ENABLED="${FINANCE_PROXY_ENABLED:-false}"
FINANCE_DOMAIN="${FINANCE_DOMAIN:-domiknote.ru}"

wait_for_url() {
  local name="$1"
  local url="$2"
  local max_attempts="${3:-30}"
  local sleep_seconds="${4:-2}"

  local attempt
  for attempt in $(seq 1 "${max_attempts}"); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "   [ok] ${name} (${attempt}/${max_attempts})"
      return 0
    fi
    echo "   [wait] ${name} is not ready yet (${attempt}/${max_attempts})"
    sleep "${sleep_seconds}"
  done

  echo "Smoke check failed: ${name} is not reachable at ${url}"
  echo "Hint: docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} ps"
  echo "Hint: docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} logs --tail=120 backend web"
  return 1
}

compose() {
  local compose_args=()
  local file
  local old_ifs="${IFS}"
  IFS=':'
  for file in ${COMPOSE_FILES}; do
    compose_args+=("-f" "${file}")
  done
  IFS="${old_ifs}"
  docker compose "${compose_args[@]}" --env-file "${ENV_FILE}" "$@"
}

wait_for_host_url() {
  local name="$1"
  local host="$2"
  local url="$3"
  local max_attempts="${4:-30}"
  local sleep_seconds="${5:-2}"

  local attempt
  for attempt in $(seq 1 "${max_attempts}"); do
    if curl -fsS -H "Host: ${host}" "${url}" >/dev/null 2>&1; then
      echo "   [ok] ${name} (${attempt}/${max_attempts})"
      return 0
    fi
    echo "   [wait] ${name} is not ready yet (${attempt}/${max_attempts})"
    sleep "${sleep_seconds}"
  done

  echo "Smoke check failed: ${name} is not reachable at ${url} with Host: ${host}"
  echo "Hint: docker compose with COMPOSE_FILES=${COMPOSE_FILES} --env-file ${ENV_FILE} ps"
  echo "Hint: docker compose with COMPOSE_FILES=${COMPOSE_FILES} --env-file ${ENV_FILE} logs --tail=120 backend web"
  return 1
}

echo "==> Building images"
compose build

echo "==> Starting stack"
compose up -d

echo "==> Waiting for backend health"
compose exec -T backend curl -fsS http://127.0.0.1:8080/api/public/health >/dev/null

echo "==> Running smoke checks"
wait_for_host_url "Public health" "${DOMAIN}" "http://127.0.0.1/healthz" 30 2

if grep -q '^NGINX_SSL=true' "${ENV_FILE}"; then
  wait_for_url "Public HTTPS health" "https://${DOMAIN}/healthz" 30 2
  wait_for_url "Public HTTPS index" "https://${DOMAIN}/" 15 2
  if [ "${FINANCE_PROXY_ENABLED}" = "true" ]; then
    wait_for_url "Finance HTTPS index" "https://${FINANCE_DOMAIN}/" 15 2
  fi
else
  wait_for_host_url "Public HTTP index" "${DOMAIN}" "http://127.0.0.1/" 15 2
fi

echo "Deployment completed."
compose ps
