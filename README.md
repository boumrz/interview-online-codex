# interview-online

Платформа для технических собеседований в реальном времени (MVP).

## Stack

- Frontend: React + TypeScript + RTK + RTK Query + Mantine UI + Rspack
- Backend: Kotlin + Spring Boot + PostgreSQL
- Agent Platform: Workflow state machine (Temporal-first, LangGraph-compatible), Linear sync adapter, policy gates, artifact registry

## Repository Structure

- `frontend` - web client
- `backend` - API + realtime SSE server
- `agents` - split English multi-agent prompt contracts (roles + shared rules)
- `TECHNICAL_SPECIFICATION.md` - detailed technical specification

## Quick Start

### 1. Запуск PostgreSQL

```bash
brew install postgresql@16
brew services start postgresql@16
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'interview') THEN CREATE ROLE interview LOGIN PASSWORD 'interview'; END IF; END \$\$;"
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "DROP DATABASE IF EXISTS interview_online;"
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "CREATE DATABASE interview_online OWNER interview;"
```

### 2. Backend

**Вариант A — PostgreSQL (как в проде):** поднимите БД (см. шаг 1) и:

```bash
cd backend
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
DB_URL=jdbc:postgresql://localhost:5432/interview_online \
DB_USER=interview \
DB_PASSWORD=interview \
mvn spring-boot:run
```

На Windows с Docker: `docker compose -f docker-compose.dev.yml up -d`, затем те же переменные `DB_*` и `mvn spring-boot:run`.

**Вариант B — без PostgreSQL (встроенная H2, только для локальной разработки):**

```powershell
# из корня репозитория
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend-local.ps1
```

Профиль `local` задаётся в `application-local.yml` (in-memory H2). API всё так же: `http://localhost:8080`.

Backend default URL: `http://localhost:8080`

Java strategy:
- `README` / `pom.xml` / `build.gradle.kts` выровнены на Java 17.
- Если локальный runtime выше (например Java 25), используйте `JAVA_HOME` на 17 для `mvn` и `gradle`.

Optional env vars:

```bash
AGENT_LINEAR_SYNC_ENABLED=true
LINEAR_API_KEY=lin_api_xxx
EXECUTION_MODE=isolated
EXECUTION_ISOLATED_URL=http://localhost:7070/api/execute
EXECUTION_FALLBACK_TO_LOCAL=false
EXECUTION_KILL_SWITCH=false
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

Опционально для вкладки Agent Ops (выключена по умолчанию):

```bash
cd frontend
FEATURE_AGENT_OPS=true npm run dev
```

## Функциональность MVP

- создание комнаты без регистрации и через личный кабинет
- вход в личный кабинет по нику (без email)
- категории задач и создание собственных задач в кабинете
- выбор языка и набора задач при создании комнаты
- вход в комнату по invite-коду
- совместное редактирование кода в реальном времени через SSE stream + POST `/events`
- управление шагами и языком редактора владельцем комнаты
- запуск кода только владельцем комнаты
- Agent orchestration API с обязательной привязкой к Linear issue
- Shared artifact registry (Postgres JSONB) для envelopes, verdicts и trace events
- Policy gates перед переходами в `QA`/`DONE`
- Environment Doctor endpoint: `GET /api/agent/environment/doctor`
- Independent reviewers: solution / security-reliability / test / ux
- Realtime fault injection API для chaos/regression прогонов
- Isolated runner mode через отдельный Docker worker

## Agent API (MVP)

- `POST /api/agent/runs` - старт run (требует `linearIssueId`)
- `POST /api/agent/runs/{runId}/transition` - state transition с handoff/retry контекстом
- `POST /api/agent/runs/{runId}/verdicts` - structured verdict от reviewer
- `POST /api/agent/runs/{runId}/reviewers/{reviewerType}/execute` - запуск независимого reviewer
- `POST /api/agent/runs/{runId}/reviewers/execute-all` - запуск полного reviewer stack
- `POST /api/agent/runs/{runId}/artifacts` - сохранение артефакта в registry
- `GET /api/agent/issues/{linearIssueId}/runs` - список run по issue
- `GET /api/agent/issues/{linearIssueId}/artifacts` - queryable registry по issue/type
- `GET /api/agent/runs/{runId}/policy` - текущий результат quality gates
- `GET /api/agent/runs/{runId}/trace` - trace-события handoff/decision
- `POST /api/agent/realtime/faults/{inviteCode}` - fault profile (latency/drop)
- `DELETE /api/agent/realtime/faults/{inviteCode}` - очистка fault profile

## Isolated Runner

Запуск отдельного execution worker:

```bash
docker compose -f docker-compose.runner.yml up -d --build
```

Backend в isolated mode:

```bash
EXECUTION_MODE=isolated EXECUTION_ISOLATED_URL=http://localhost:7070/api/execute mvn spring-boot:run
```

## Chaos QA Harness

```bash
cd frontend
npm run chaos:test
npm run chaos:faults
```

## Примечания

- Для MVP используется server-authoritative синхронизация документа.
- WebRTC оставлен как следующий этап оптимизации.
