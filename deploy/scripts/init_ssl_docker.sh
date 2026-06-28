#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/interview-online}"
REPO_DIR="${REPO_DIR:-${APP_ROOT}/repo}"
ENV_FILE="${ENV_FILE:-/etc/interview-online/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_DIR}/docker-compose.prod.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Environment file is missing: ${ENV_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_DIR}/docker-compose.prod.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-${COMPOSE_FILE}}"
DOMAIN="${DOMAIN:-interview.vtools.tech}"
CERTBOT_DOMAINS="${CERTBOT_DOMAINS:-${DOMAIN}}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

if [ -z "${CERTBOT_EMAIL}" ]; then
  echo "Set CERTBOT_EMAIL in ${ENV_FILE} before running this script."
  exit 1
fi

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

certbot_domain_args=()
for cert_domain in $(printf '%s' "${CERTBOT_DOMAINS}" | tr ',' ' '); do
  if [ -n "${cert_domain}" ]; then
    certbot_domain_args+=("-d" "${cert_domain}")
  fi
done

if [ "${#certbot_domain_args[@]}" -eq 0 ]; then
  echo "Set CERTBOT_DOMAINS or DOMAIN before running this script."
  exit 1
fi

echo "==> Requesting certificate for ${CERTBOT_DOMAINS}"
compose --profile certbot run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  "${certbot_domain_args[@]}"

echo "==> Enabling HTTPS in ${ENV_FILE}"
if grep -q '^NGINX_SSL=' "${ENV_FILE}"; then
  sed -i "s/^NGINX_SSL=.*/NGINX_SSL=true/" "${ENV_FILE}"
else
  echo "NGINX_SSL=true" >> "${ENV_FILE}"
fi

echo "==> Restarting web container with TLS"
compose up -d web

echo "SSL enabled for ${CERTBOT_DOMAINS}"
