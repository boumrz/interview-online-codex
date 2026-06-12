#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.docker.local}"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
LOCAL_COMPOSE_FILE="${ROOT_DIR}/docker-compose.local.yml"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}"
  echo "Copy from deploy/env/docker.env.example and set HTTP_PORT=8888 for local."
  exit 1
fi

cd "${ROOT_DIR}"

compose() {
  docker compose -f "${COMPOSE_FILE}" -f "${LOCAL_COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

case "${1:-up}" in
  up)
    compose up -d --build
    http_port="$(grep '^HTTP_PORT=' "${ENV_FILE}" | cut -d= -f2)"
    echo ""
    echo "Open:      http://localhost:${http_port}/"
    echo "Health:    http://localhost:${http_port}/healthz"
    echo "API:       http://localhost:${http_port}/api/public/health"
    ;;
  down)
    compose down
    ;;
  logs)
    compose logs -f "${2:-}"
    ;;
  ps)
    compose ps
    ;;
  *)
    echo "Usage: $0 [up|down|logs|ps]"
    exit 1
    ;;
esac
