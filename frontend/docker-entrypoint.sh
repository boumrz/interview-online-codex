#!/bin/sh
set -eu

DOMAIN="${DOMAIN:-interview.vtools.tech}"
INTERVIEW_SERVER_NAMES="$(printf '%s' "${INTERVIEW_SERVER_NAMES:-$DOMAIN}" | tr ',' ' ')"
FINANCE_DOMAIN="${FINANCE_DOMAIN:-domiknote.ru}"
FINANCE_CERT_DOMAIN="${FINANCE_CERT_DOMAIN:-$FINANCE_DOMAIN}"
FINANCE_WEB_UPSTREAM="${FINANCE_WEB_UPSTREAM:-finance-assistant-web-1:80}"
FINANCE_PROXY_ENABLED="${FINANCE_PROXY_ENABLED:-false}"

export DOMAIN
export INTERVIEW_SERVER_NAMES
export FINANCE_DOMAIN
export FINANCE_CERT_DOMAIN
export FINANCE_WEB_UPSTREAM

if [ "${NGINX_SSL:-false}" = "true" ]; then
  envsubst '${DOMAIN} ${INTERVIEW_SERVER_NAMES} ${FINANCE_DOMAIN} ${FINANCE_CERT_DOMAIN} ${FINANCE_WEB_UPSTREAM}' \
    < /etc/nginx/templates/ssl.conf.template > /etc/nginx/conf.d/default.conf

  if [ "${FINANCE_PROXY_ENABLED}" = "true" ]; then
    if [ ! -f "/etc/letsencrypt/live/${FINANCE_CERT_DOMAIN}/fullchain.pem" ] ||
      [ ! -f "/etc/letsencrypt/live/${FINANCE_CERT_DOMAIN}/privkey.pem" ]; then
      echo "Finance proxy is enabled but certificate files are missing for ${FINANCE_CERT_DOMAIN}." >&2
      echo "Issue the certificate before setting FINANCE_PROXY_ENABLED=true." >&2
      exit 1
    fi
    envsubst '${FINANCE_DOMAIN} ${FINANCE_CERT_DOMAIN} ${FINANCE_WEB_UPSTREAM}' \
      < /etc/nginx/templates/finance-ssl.conf.template >> /etc/nginx/conf.d/default.conf
  fi
else
  envsubst '${INTERVIEW_SERVER_NAMES} ${FINANCE_DOMAIN} ${FINANCE_WEB_UPSTREAM}' \
    < /etc/nginx/templates/http.conf > /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
