#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/interview-online}"
REPO_DIR="${REPO_DIR:-${APP_ROOT}/repo}"
RELEASES_DIR="${RELEASES_DIR:-${APP_ROOT}/releases}"
CURRENT_LINK="${CURRENT_LINK:-${APP_ROOT}/current}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-interview.domiknote.ru}"
SERVICE_NAME="${SERVICE_NAME:-interview-online-backend}"
BACKEND_HEALTH_PORT="${BACKEND_HEALTH_PORT:-18080}"
SKIP_SUDO_CHECK="${SKIP_SUDO_CHECK:-false}"

if ! command -v mvn >/dev/null 2>&1; then
  echo "mvn is not installed."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed."
  exit 1
fi

if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "Git repository is missing at ${REPO_DIR}"
  exit 1
fi

if [ "${SKIP_SUDO_CHECK}" != "true" ] && [ "$(id -u)" -ne 0 ]; then
  # Check sudo non-interactively with a command this script already needs later.
  if ! sudo -n /usr/bin/systemctl daemon-reload >/dev/null 2>&1; then
    echo "sudo requires passwordless access for deploy automation."
    echo "Configure /etc/sudoers.d/deploy-interview-online first."
    echo "Expected: /usr/bin/systemctl daemon-reload, restart ${SERVICE_NAME}, reload nginx."
    exit 1
  fi
fi

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
  echo "Hint: sudo systemctl status ${SERVICE_NAME} --no-pager -l"
  echo "Hint: sudo journalctl -u ${SERVICE_NAME} -n 120 --no-pager"
  return 1
}

timestamp="$(date +%Y%m%d%H%M%S)"
release_dir="${RELEASES_DIR}/${timestamp}"

echo "==> Fetching source (${BRANCH})"
cd "${REPO_DIR}"
git fetch --all --tags
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "==> Creating release directory ${release_dir}"
mkdir -p "${release_dir}"
rsync -a --delete \
  --exclude ".git" \
  --exclude "frontend/node_modules" \
  --exclude "frontend/dist" \
  --exclude "backend/target" \
  "${REPO_DIR}/" "${release_dir}/"

echo "==> Building frontend"
cd "${release_dir}/frontend"
npm ci
npm run typecheck
npm run build

echo "==> Building backend"
cd "${release_dir}/backend"
mvn -B -DskipTests package
cp target/interview-online-backend-0.0.1-SNAPSHOT.jar interview-online-backend.jar

echo "==> Updating current symlink"
ln -sfn "${release_dir}" "${CURRENT_LINK}"

echo "==> Reloading services"
sudo systemctl daemon-reload
sudo systemctl restart "${SERVICE_NAME}"
sudo systemctl reload nginx

echo "==> Running smoke checks"
wait_for_url "Backend health" "http://127.0.0.1:${BACKEND_HEALTH_PORT}/api/agent/environment/doctor" 45 2
wait_for_url "Public healthz" "https://${DOMAIN}/healthz" 30 2
wait_for_url "Public index" "https://${DOMAIN}/" 15 2

echo "Deployment completed: ${release_dir}"
