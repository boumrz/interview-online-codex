#!/bin/sh
set -eu

DOMAIN="${DOMAIN:-interview.vtools.tech}"

if [ "${NGINX_SSL:-false}" = "true" ]; then
  envsubst '${DOMAIN}' < /etc/nginx/templates/ssl.conf.template > /etc/nginx/conf.d/default.conf
else
  cp /etc/nginx/templates/http.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
