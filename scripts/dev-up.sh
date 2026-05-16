#!/usr/bin/env bash
# One-command launcher для локальной разработки на macOS / Linux.
#
# Что делает:
#   1. Поднимает PostgreSQL (Docker-compose; fallback — brew postgresql@16).
#   2. Дожидается готовности БД.
#   3. Стартует backend (mvn spring-boot:run) в фоне.
#   4. Дожидается /actuator/health.
#   5. Стартует frontend (npm run dev) в фоне.
#   6. Открывает браузер на http://localhost:5173.
#   7. По Ctrl+C аккуратно гасит оба процесса.
#
# Логи:
#   .run/backend.log
#   .run/frontend.log
#
# Использование:
#   ./scripts/dev-up.sh                 # запустить
#   ./scripts/dev-up.sh --stop          # погасить уже запущенные процессы
#   tail -f .run/backend.log            # смотреть логи

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)"
cd "$ROOT_DIR"

RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$RUN_DIR/backend.log"
FRONTEND_LOG="$RUN_DIR/frontend.log"

cleanup() {
  echo
  echo ">>> Останавливаю процессы..."
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local pid
    pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$BACKEND_PID_FILE"
  fi
  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    local pid
    pid="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$FRONTEND_PID_FILE"
  fi
  echo "Готово. Логи сохранены в $RUN_DIR/"
}

if [[ "${1:-}" == "--stop" ]]; then
  cleanup
  exit 0
fi

trap cleanup INT TERM

# ----- 1. Prerequisites ------------------------------------------------------
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Не нашёл $1. Установи и попробуй снова."
    exit 1
  fi
}

need node
need npm

JAVA_BIN=""
if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
  JAVA_BIN="$JAVA_HOME/bin/java"
elif [[ -d "/Library/Java/JavaVirtualMachines/temurin-17.jdk" ]]; then
  export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
  JAVA_BIN="$JAVA_HOME/bin/java"
elif command -v /usr/libexec/java_home >/dev/null 2>&1; then
  JAVA_HOME_TRY="$( /usr/libexec/java_home -v 17 2>/dev/null || true )"
  if [[ -n "$JAVA_HOME_TRY" ]]; then
    export JAVA_HOME="$JAVA_HOME_TRY"
    JAVA_BIN="$JAVA_HOME/bin/java"
  fi
fi
if [[ -z "$JAVA_BIN" ]]; then
  echo "❌ Не нашёл JDK 17. Установи через 'brew install --cask temurin@17' или укажи JAVA_HOME."
  exit 1
fi

if command -v mvn >/dev/null 2>&1; then
  MVN="mvn"
else
  echo "❌ Не нашёл mvn в PATH. Установи: 'brew install maven'."
  exit 1
fi

# ----- 2. Postgres ----------------------------------------------------------
echo ">>> Поднимаю PostgreSQL..."
PG_READY=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose -f docker-compose.dev.yml up -d
  for _ in $(seq 1 45); do
    if docker exec interview-online-postgres pg_isready -U interview -d interview_online >/dev/null 2>&1; then
      PG_READY=1
      break
    fi
    sleep 1
  done
elif command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q "postgresql@16"; then
  brew services start postgresql@16 >/dev/null
  PSQL="$(brew --prefix postgresql@16 2>/dev/null)/bin/psql"
  for _ in $(seq 1 30); do
    if "$PSQL" -U postgres -c '\q' >/dev/null 2>&1 || \
       "$PSQL" postgres -c '\q' >/dev/null 2>&1; then
      PG_READY=1
      break
    fi
    sleep 1
  done
  # Создаём роль/БД, если их ещё нет.
  "$PSQL" postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'interview') THEN CREATE ROLE interview LOGIN PASSWORD 'interview'; END IF; END \$\$;" >/dev/null 2>&1 || true
  "$PSQL" postgres -c "SELECT 1 FROM pg_database WHERE datname = 'interview_online'" 2>/dev/null | grep -q 1 || \
    "$PSQL" postgres -c "CREATE DATABASE interview_online OWNER interview;" >/dev/null 2>&1 || true
else
  echo "❌ Не нашёл ни Docker, ни brew postgresql@16. Установи что-то одно — см. README §1."
  exit 1
fi

if [[ "$PG_READY" -ne 1 ]]; then
  echo "❌ PostgreSQL не поднялся за разумное время."
  exit 1
fi
echo "✅ PostgreSQL готов."

# ----- 3. Backend -----------------------------------------------------------
echo ">>> Стартую backend (Spring Boot)..."
export DB_URL="${DB_URL:-jdbc:postgresql://localhost:5432/interview_online}"
export DB_USER="${DB_USER:-interview}"
export DB_PASSWORD="${DB_PASSWORD:-interview}"

(
  cd "$ROOT_DIR/backend"
  : > "$BACKEND_LOG"
  "$MVN" -q spring-boot:run \
    >> "$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID_FILE"
)
echo "    pid=$(cat "$BACKEND_PID_FILE")  log=$BACKEND_LOG"

echo ">>> Жду /actuator/health (может занять до 90 сек на первом запуске)..."
HEALTH=0
for _ in $(seq 1 90); do
  if curl -fsS http://localhost:8080/actuator/health 2>/dev/null | grep -q '"status":"UP"'; then
    HEALTH=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH" -ne 1 ]]; then
  echo "❌ Backend не поднялся. Смотри $BACKEND_LOG"
  cleanup
  exit 1
fi
echo "✅ Backend готов: http://localhost:8080"

# ----- 4. Frontend ----------------------------------------------------------
echo ">>> Стартую frontend (rspack dev)..."
(
  cd "$ROOT_DIR/frontend"
  if [[ ! -d node_modules ]]; then
    echo "    node_modules не найден — npm install..."
    npm install --no-audit --no-fund >> "$FRONTEND_LOG" 2>&1
  fi
  : > "$FRONTEND_LOG"
  npm run dev >> "$FRONTEND_LOG" 2>&1 &
  echo $! > "$FRONTEND_PID_FILE"
)
echo "    pid=$(cat "$FRONTEND_PID_FILE")  log=$FRONTEND_LOG"

echo ">>> Жду :5173..."
FE_READY=0
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
    FE_READY=1
    break
  fi
  sleep 1
done
if [[ "$FE_READY" -ne 1 ]]; then
  echo "❌ Frontend не отозвался. Смотри $FRONTEND_LOG"
  cleanup
  exit 1
fi
echo "✅ Frontend готов: http://localhost:5173"

# ----- 5. Open browser ------------------------------------------------------
if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173"
fi

echo
echo "════════════════════════════════════════════════════════════"
echo " ✅ Всё запущено."
echo "    Frontend: http://localhost:5173"
echo "    Backend:  http://localhost:8080"
echo "    Логи:     $BACKEND_LOG  /  $FRONTEND_LOG"
echo
echo " Ctrl+C — погасит оба процесса."
echo " Или в отдельном терминале: ./scripts/dev-up.sh --stop"
echo "════════════════════════════════════════════════════════════"

# Держим скрипт живым, пока пользователь не нажмёт Ctrl+C.
wait
