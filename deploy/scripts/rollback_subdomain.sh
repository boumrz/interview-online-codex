#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/interview-online}"
RELEASES_DIR="${RELEASES_DIR:-${APP_ROOT}/releases}"
CURRENT_LINK="${CURRENT_LINK:-${APP_ROOT}/current}"
SERVICE_NAME="${SERVICE_NAME:-interview-online-backend}"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <release-id>"
  echo "Example: $0 20260319191500"
  exit 1
fi

target_release="${RELEASES_DIR}/$1"

if [ ! -d "${target_release}" ]; then
  echo "Release does not exist: ${target_release}"
  exit 1
fi

echo "Switching current symlink to ${target_release}"
ln -sfn "${target_release}" "${CURRENT_LINK}"

echo "Restarting backend and reloading nginx"
sudo systemctl restart "${SERVICE_NAME}"
sudo systemctl reload nginx

echo "Rollback completed."

