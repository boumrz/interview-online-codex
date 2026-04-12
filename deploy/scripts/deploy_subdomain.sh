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

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

repo_write_access_ok() {
  local marker="${REPO_DIR}/.git/.permission-check.$$"
  local must_be_writable=(
    "${REPO_DIR}/.git/index"
    "${REPO_DIR}/.git/packed-refs"
  )
  local path

  if ! touch "${marker}" >/dev/null 2>&1; then
    return 1
  fi
  rm -f "${marker}" || true

  for path in "${must_be_writable[@]}"; do
    if [ -e "${path}" ] && [ ! -w "${path}" ]; then
      return 1
    fi
  done

  return 0
}

ensure_repo_writable() {
  if ! repo_write_access_ok; then
    echo "==> Repairing repository permissions for ${REPO_DIR}"
    run_privileged chown -R "$(id -u):$(id -g)" "${REPO_DIR}"

    if ! repo_write_access_ok; then
      echo "Repository permissions are still invalid after chown."
      echo "Please inspect ownership and ACLs for ${REPO_DIR}/.git"
      exit 1
    fi
  fi

  # Cleanup stale locks from interrupted git operations.
  rm -f \
    "${REPO_DIR}/.git/index.lock" \
    "${REPO_DIR}/.git/shallow.lock" \
    "${REPO_DIR}/.git/packed-refs.lock" \
    "${REPO_DIR}/.git/HEAD.lock" || true
}

ensure_git_safe_directory() {
  local repo_realpath
  repo_realpath="$(cd "${REPO_DIR}" && pwd -P)"

  if ! git config --global --get-all safe.directory | grep -Fxq "${repo_realpath}"; then
    echo "==> Marking git safe.directory: ${repo_realpath}"
    git config --global --add safe.directory "${repo_realpath}"
  fi
}

require_deploy_sudo() {
  if [ "${SKIP_SUDO_CHECK}" = "true" ] || [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if ! sudo -n /usr/bin/systemctl daemon-reload >/dev/null 2>&1; then
    echo "sudo requires passwordless access for deploy automation."
    echo "Configure /etc/sudoers.d/deploy-interview-online first."
    echo "Expected: /usr/bin/systemctl daemon-reload, restart ${SERVICE_NAME}, reload nginx."
    exit 1
  fi
  if ! repo_write_access_ok; then
    if ! sudo -n chown "$(id -u):$(id -g)" "${REPO_DIR}" >/dev/null 2>&1; then
      echo "sudo requires passwordless chown for ${REPO_DIR} when the repo is not writable (e.g. after operations as root)."
      echo "Add NOPASSWD for chown on that path (see deploy/env/sudoers-deploy-interview-online.example; match command -v chown on the server)."
      exit 1
    fi
  fi
}

timestamp="$(date +%Y%m%d%H%M%S)"
release_dir="${RELEASES_DIR}/${timestamp}"

require_deploy_sudo
ensure_repo_writable
ensure_git_safe_directory

echo "==> Fetching source (${BRANCH})"
cd "${REPO_DIR}"
git fetch --all --tags --no-write-fetch-head
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
wait_for_url "Backend health" "http://127.0.0.1:${BACKEND_HEALTH_PORT}/api/public/health" 45 2
wait_for_url "Public backend health" "https://${DOMAIN}/api/public/health" 30 2
wait_for_url "Public index" "https://${DOMAIN}/" 15 2

echo "Deployment completed: ${release_dir}"
