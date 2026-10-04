# InterHub

Платформа для технических собеседований в реальном времени (MVP).

## Stack

- Frontend: React + TypeScript + RTK + RTK Query + Ant Design v6 + CSS Modules + Rspack
- Backend: Kotlin + Spring Boot + PostgreSQL
- Agent Platform: Workflow state machine (Temporal-first, LangGraph-compatible), Linear sync adapter, policy gates, artifact registry

## Repository Structure

- `frontend` - web client
- `backend` - API + realtime SSE server
- `agents` - split English multi-agent prompt contracts (roles + shared rules)
- `SPEC.md` - feature index and current work order
- `specs/features` - one active product/implementation specification per feature
- `openspec` - historical archive of the previous OpenSpec workflow

## Development Workflow

Use `SPEC.md` to find the relevant feature specification in `specs/features/`.
Follow the [specification standard](specs/README.md); use the
[feature template](specs/templates/feature.md) for new work. Update requirements
in place, make a brief completeness pass, test executable behavior first and
verify the smallest coherent change in proportion to risk. Significant access,
realtime and migration changes require an independent scoped review before release.

Direct implementation is the default. Specialist roles, Linear and separate
planning artifacts are used when the task actually needs them. Keep current
contracts separate from historical run reports in `specs/references/`.

The `openspec/` directory is retained only for historical context and evidence.
New work should not create OpenSpec changes or require the OpenSpec CLI.

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

Один раз создайте 32-byte Base64URL secret без padding и сохраните его во внешнем
менеджере секретов или локальном environment-файле вне репозитория:

```bash
export CHAT_RECEIPT_HMAC_SECRET="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
```

Один и тот же `CHAT_RECEIPT_HMAC_SECRET` должен использоваться после перезапуска
и всеми репликами. Не ротируйте его до момента, когда прошло строго
больше 48 часов после последнего успешного chat ACK: вторые 24 часа хранят tombstone.
Смешивать реплики с разными HMAC secrets нельзя; непрерывная ротация требует отдельной dual-key migration.

Командные пространства доступны во всех сборках. Перед запуском backend также
настройте постоянный 32-byte Base64URL ключ приглашений без padding, сохранённый
вне репозитория. Для ключа `primary` передайте его через конфигурацию Spring:

```bash
export TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID=primary
export APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY="${TEAM_INVITATION_LINK_ENCRYPTION_KEY:?Загрузите сохранённый ключ приглашений}"
```

Используйте один и тот же ключ после перезапуска и во всех репликах. Backend
проверяет конфигурацию при запуске. Для нескольких версий ключей задайте
`app.team-invitation-link-encryption.keys` через внешний конфигурационный файл
или `SPRING_APPLICATION_JSON`; сохраняйте прежние ключи, пока есть ожидающие
приглашения, которые на них ссылаются.

```bash
cd backend
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
DB_URL=jdbc:postgresql://localhost:5432/interview_online \
DB_USER=interview \
DB_PASSWORD=interview \
CHAT_RECEIPT_HMAC_SECRET="$CHAT_RECEIPT_HMAC_SECRET" \
mvn spring-boot:run
```

На Windows с Docker: `docker compose -f docker-compose.dev.yml up -d`, затем те же переменные `DB_*`, обязательные стабильные ключи чата и приглашений и `mvn spring-boot:run`.

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
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

### Изолированные браузерные тесты

Обычные `npm run e2e:<suite>` создают собственную временную схему в отдельной
PostgreSQL 16 базе и поднимают свои backend/frontend на свободных портах.
После завершения или ошибки процессы и схема удаляются. Рабочая база
`interview_online` и запущенное приложение не используются для fixtures.

```bash
cd frontend
# Укажите отдельную базу, принадлежащую тестовому PostgreSQL пользователю.
TEAM_TEST_PG_DATABASE=interview_e2e npm run e2e:auth
npm run test:e2e-fixture-safety
```

База должна существовать; без `TEAM_TEST_PG_DATABASE` runner выберет принадлежащую
текущему пользователю базу `interview_*`, исключая `interview_online`. Для подключения
поддерживаются `TEAM_TEST_PG_HOST` (только loopback), `TEAM_TEST_PG_PORT`, `TEAM_TEST_PG_USER`,
`TEAM_TEST_PG_PASSWORD` и `PSQL_BIN`. Нужны PostgreSQL 16, Maven и Java 17.
`E2E_PRODUCTION=true` проверяет production-сборку frontend. Можно выбрать конкретный
файл через `node tests/e2e/run-isolated.mjs tests/e2e/account/e2e-auth-navigation.mjs`.

Прямой запуск файла без runner завершается до регистрации и других fixtures:
центральная проверка требует подтверждения временной схемы от API и его web proxy.
Старые `E2E_API_URL`/`E2E_BASE_URL` переопределения и адреса `8080`/`5173` запрещены
для fixture-прогонов. При необходимости задайте свободные `E2E_BACKEND_PORT` и
`E2E_WEB_PORT`; сохраняются алиасы существующих командных runner.

### Локальная отладка командного сценария

Для приглашений нужен постоянный 32-byte Base64URL ключ
`app.team-invitation-link-encryption.keys` и его `active-key-id`; храните его
вне репозитория и используйте тот же ключ после перезапуска. Если локальные
секреты уже сохранены в игнорируемых файлах `backend/.run/chat-receipt.secret`
и `backend/.run/team-invitation-link-encryption.key`, запустите PostgreSQL,
затем backend и frontend в двух терминалах так:

```bash
cd backend
chat_receipt_secret="$(<.run/chat-receipt.secret)"
team_link_key="$(<.run/team-invitation-link-encryption.key)"
spring_config_json="{\"app\":{\"team-invitation-link-encryption\":{\"active-key-id\":\"primary\",\"keys\":{\"primary\":\"$team_link_key\"}}}}"
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
FEATURE_TEAM_MERGE_COMMIT=true \
CHAT_RECEIPT_HMAC_SECRET="$chat_receipt_secret" \
SPRING_APPLICATION_JSON="$spring_config_json" mvn spring-boot:run

cd ../frontend
FEATURE_TEAM_MERGE_COMMIT=true npm run dev
```

Для совместного локального запуска backend и frontend используйте
`scripts/dev-up.sh`, предварительно передав те же стабильные ключи через
окружение. Выбор и создание команд доступны без отдельного флага.

`FEATURE_TEAM_MERGE_COMMIT=true` в примере нужен только для отладки финального
запуска объединения команд. По умолчанию этот флаг выключен;
общая проверка активности комнат для нескольких процессов находится в
PostgreSQL. Если порт `5173` уже занят, используйте для frontend
`npm run dev -- --port 5174`. Codex не перезапускает уже работающий локальный
сервер без просьбы пользователя.

Маршрут для ручной отладки: создать две команды и пригласить участников →
завести трек, вакансию и задачи → собрать программу интервью → провести
интервью в комнате → завершить его и проверить результат/экспорт → в первой
команде создать план объединения со второй → получить согласование обоих
владельцев → выполнить объединение и проверить старые ссылки и права доступа.
Подробные критерии каждого шага находятся в [спецификациях фич](specs/features/).

Опционально для вкладки Agent Ops (выключена по умолчанию):

```bash
cd frontend
FEATURE_AGENT_OPS=true npm run dev
```

Опционально для Яндекс Метрики (события отправляются только с разрешённых хостов):

```bash
cd frontend
VITE_METRIKA_ALLOWED_HOSTS=interview.domiknote.ru npm run dev
```

### Сжатие трафика (Brotli/Gzip)

- При `npm run build` фронтенд дополнительно создаёт предварительно сжатые файлы:
  - `*.br` (Brotli, quality 11)
  - `*.gz` (Gzip, level 9)
- Сжимаются в первую очередь текстовые ресурсы (`js/css/html/svg/json/map/xml/txt/wasm`) размером от 1 KiB.
- Для backend включено HTTP-сжатие JSON/HTML/CSS/JS ответов Spring Boot (`server.compression.enabled=true`).
- Для Nginx включено `gzip` с `Vary: Accept-Encoding`.
- SSE трафик `/api/realtime/` не ломается, так как `text/event-stream` в типы сжатия не добавляется.

Проверка:

```bash
curl -I -H "Accept-Encoding: gzip" https://<your-domain>/
```

В ответе должен быть заголовок `Content-Encoding: gzip`.

## Функциональность MVP

- создание комнаты без регистрации и через личный кабинет
- вход в личный кабинет по нику (без email)
- категории задач и создание собственных задач в кабинете
- выбор языка и набора задач при создании комнаты
- вход в комнату по invite-коду
- совместное редактирование кода в реальном времени через SSE stream + POST `/events`
- управление шагами и языком редактора владельцем комнаты
- Agent orchestration API с обязательной привязкой к Linear issue
- Shared artifact registry (Postgres JSONB) для envelopes, verdicts и trace events
- Policy gates перед переходами в `QA`/`DONE`
- Environment Doctor endpoint: `GET /api/agent/environment/doctor`
- Independent reviewers: solution / security-reliability / test / ux
- Realtime fault injection API для chaos/regression прогонов

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

Environment Doctor требует токен аккаунта InterHub в переменной окружения
`INTERHUB_AUTH_TOKEN`. Для локальной проверки из Bash можно ввести его без
отображения и записи в историю команд:

```bash
read -r -s -p 'Токен аккаунта InterHub: ' INTERHUB_AUTH_TOKEN
printf '\n'
export INTERHUB_AUTH_TOKEN
bash backend/scripts/environment_doctor.sh http://localhost:8080
unset INTERHUB_AUTH_TOKEN
```

Скрипт передаёт токен только в заголовке авторизации и показывает итоговый
`PASS` или `WARN`. Отсутствие токена, ошибка запроса, некорректный отчёт и
результат `FAIL` завершают проверку с ненулевым кодом.

## Chaos QA Harness

```bash
cd frontend
npm run chaos:test
npm run chaos:faults
```

## Примечания

- Для MVP используется server-authoritative синхронизация документа.
- WebRTC оставлен как следующий этап оптимизации.
