#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/interview-online}"
REPO_DIR="${REPO_DIR:-${APP_ROOT}/repo}"
ENV_FILE="${ENV_FILE:-/etc/interview-online/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_DIR}/docker-compose.prod.yml}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Environment file is missing: ${ENV_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

DOMAIN="${DOMAIN:-interview.vtools.tech}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

if [ -z "${CERTBOT_EMAIL}" ]; then
  echo "Set CERTBOT_EMAIL in ${ENV_FILE} before running this script."
  exit 1
fi

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

echo "==> Requesting certificate for ${DOMAIN}"
compose --profile certbot run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}"

echo "==> Enabling HTTPS in ${ENV_FILE}"
if grep -q '^NGINX_SSL=' "${ENV_FILE}"; then
  sed -i "s/^NGINX_SSL=.*/NGINX_SSL=true/" "${ENV_FILE}"
else
  echo "NGINX_SSL=true" >> "${ENV_FILE}"
fi

echo "==> Restarting web container with TLS"
compose up -d web

echo "SSL enabled for https://${DOMAIN}"
