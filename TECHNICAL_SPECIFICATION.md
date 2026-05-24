# Technical Specification: interview-online

> **Версия документа:** 2.1 (актуализировано 2026-05-23 — добавлены фичи
> финального verdict, paste detection и полного keystroke timeline + экспорт).
> Версия 2.0 (2026-05-17) актуализирована после аудита кода.
> Предыдущая версия (v1.0) описывала ~30% реальной функциональности и не учитывала
> Agent platform, anti-cheat, Yjs CRDT и личный кабинет.

---

## 0. Назначение документа

Спецификация — единый источник истины о том, **что платформа уже умеет** и
**куда она идёт**. Используется:

- Specification Agent / Product Owner Agent при формировании новых эпиков.
- Architect / Team Lead при декомпозиции задач.
- Любым новым агентом / разработчиком при онбординге, чтобы не перечитывать
  репозиторий с нуля.

Сопутствующий артефакт анализа влияния платформы на воронку найма лежит в
`analytics/` (не коммитится).

---

## 1. Продуктовая цель

Платформа для проведения **технических интервью** с совместным редактированием
кода в реальном времени.

**Прямые цели (текущие)**:

- интервьюер создаёт комнату, делится invite-ссылкой, проводит интервью;
- кандидат и интервьюер совместно редактируют код в одном редакторе;
- интервьюер ведёт заметки, переключает шаги (задачи), оценивает решения;
- владелец видит «след» поведения кандидата (anti-cheat сигналы).

**Стратегические цели (вектор развития)**:

- встроиться в воронку найма как этап pre-screen + tech-interview + cross-team
  shared candidate pool;
- сократить расход времени интервьюеров за счёт раннего отсева списывающих и
  слабых кандидатов;
- сделать данные интервью переиспользуемыми между командами (calibration,
  re-routing сильных «незакрытых» кандидатов).

---

## 2. Роли пользователей

### Системные роли (`users.role`)

- `user` — обычный аккаунт;
- `admin` — администратор инстанса (видит `/dashboard/admin`, может менять роли,
  удалять пользователей).

### Роли в комнате (`RoomAccessService.RoomRole`)

- `OWNER` — создатель комнаты или владелец по `owner_session_token`;
- `INTERVIEWER` — приглашённый интервьюер;
- `CANDIDATE` — все остальные участники по invite-link.

Полномочия:
`canManageRoom = OWNER || INTERVIEWER`, `canGrantAccess = OWNER`.

> ⚠️ В `frontend/src/features/auth/authSlice.ts` зашит admin-bypass для никнейма
> `boumrz`. Это backdoor, который должен быть выпилен перед публичным
> релизом — реальное право всё равно проверяется сервером.

---

## 3. Скоуп

### 3.1 Реализовано

**Управление комнатами**: guest-комната без регистрации (`POST /api/public/rooms`),
авторизованная комната с предзагруженными `taskIds` (`POST /api/rooms`),
управление шагами / задачами / участниками комнаты, личные комнаты текущего
юзера (`/dashboard/rooms`, `/dashboard/manage`).

**Аутентификация**: регистрация / логин по **никнейму** (не email), BCrypt,
long-lived session tokens в таблице `user_sessions` (без `expires_at`); три
типа токенов: user (`usr_*`), room owner (`owner_*`), interviewer
(`interviewer_*`).

**Realtime коллаборация**: транспорт — **SSE** (`GET /api/realtime/rooms/{inviteCode}/stream`)
+ POST events (`POST /api/realtime/rooms/{inviteCode}/events`). Heartbeat 5 c,
nginx timeout 3600 c. CRDT — **Yjs + y-codemirror.next + y-protocols** на
фронте + server-side apply / snapshot в `Room.yjsDocumentBase64` (до 400 KB
base64). Параллельно поддерживается server-authoritative full-document sync с
`codeSequence` (LWW) как fallback. Presence (`active` / `away`), курсоры,
awareness. Dedupe `operationId` (15 мин TTL, 20k events). Reconnect через
`request_state_sync` (полный snapshot комнаты).

**Code editor**: **CodeMirror 6** (НЕ Monaco, как ошибочно писалось в CLAUDE.md);
языки: `nodejs` (alias `javascript`/`typescript`), `python`, `kotlin` (без
граммара — голый текст), `java`, `sql`, `plaintext`; multi-step задачи с
`starterCode`, `solutionCode`, `language`, `score`, `briefingMarkdown` на
каждый шаг; автосохранение кода и истории клавиш кандидата (debounced в БД).

**Личный кабинет (`/dashboard/:section`)**: `rooms` (мои комнаты), `tasks`
(банк задач по языкам, с категориями), `manage` (управление комнатами),
`agents` (Agent Ops, флаг `FEATURE_AGENT_OPS=true`), `admin`.

**Личный банк задач**: `user_task_categories` + `user_task_templates`, сид
дефолтных задач при регистрации, CRUD через `/api/me/tasks`.

**Anti-cheat (зачаточный)**: захват key-events только у роли `CANDIDATE`;
`keydown` + синтетический `Tab` на `window.blur` (Alt+Tab / Cmd+Tab);
`visibilitychange` → `tab_hidden` / `tab_visible`; `window.focus` / `window.blur`;
хранится **последние 50 событий** (`Room.candidateKeyHistory`); бродкастится
только участникам с `canManageRoom`.

**Заметки и материалы интервью**: персональные заметки интервьюера
(`Room.privateNotesJson`) с авто-блоками «Шаг N»; общие заметки кандидата
(`Room.notes`); chat-log интервьюеров (`Room.interviewerChat`); briefing
markdown на уровне комнаты и каждого шага; экспорт заметок в Markdown / PDF.

**Метрики**: Яндекс Метрика на frontend (counter `109032539`), webvisor,
clickmap, параметры `auth_status` / `role` / `UserID`; structured-логи для
agent-событий.

**Chaos / надёжность**: fault injection API
(`/api/agent/realtime/faults/{inviteCode}`): latency, drop-every-Nth;
chaos-сценарии на Playwright (`npm run chaos:test`, `chaos:faults`);
Environment Doctor (`/api/agent/environment/doctor`).

**Agent platform (внутренний инструмент разработки)**: workflow state-machine
BACKLOG → REFINEMENT → READY → IN_PROGRESS → IN_REVIEW → QA → DONE + BLOCKED;
`agent_task_runs`, `agent_artifacts` (опц. pgvector embedding(1536)),
`agent_review_verdicts`, `agent_trace_events`; policy gates
(`policy-gates.json`); 4 reviewer-рантайма (эвристики, не LLM): SOLUTION,
SECURITY, TEST, UX; Linear sync (опц.); Langfuse bridge (опц.); OTel spans
(без сконфигурированного экспортёра).

**Деплой**: frontend — статика из `dist` (Brotli/Gzip precompress); backend —
systemd unit на порту 18080; nginx subdomain `interview.domiknote.ru`.

### 3.2 Вне скоупа MVP / не реализовано

> ⚠️ Здесь зафиксирован реальный gap. Многие из этих пунктов попадают в Excel
> анализа (`analytics/`) как кандидаты на бэклог.

**Запуск кода в комнате**: не реализован и исключён из roadmap. Редактор — только совместное редактирование (Yjs CRDT), без выполнения кода.

**Полноценный anti-cheat**: paste detection из буфера — **в разработке**
(см. FR-11); нет AI-детекции / стилометрии / сравнения с ChatGPT-паттернами;
нет полноэкранного фокус-режима; нет watermark / face-tracking / webcam.

**Запись и реплей**: нет видеозаписи / аудиозаписи; нет покадрового replay
coding (Yjs-апдейты применяются и теряются); полный keystroke timeline +
экспорт — **в разработке** (см. FR-12; in-memory буфер 50 событий остаётся для
real-time UI); нет calibration между интервьюерами.

**Идентичность кандидата**: кандидат — анонимный участник с произвольным
`displayName`; нет таблицы `candidate_profile`; нет связки email→интервью;
нельзя отследить «один и тот же кандидат был полгода назад»; нет связи с CV.

**Оценка интервью**: скоринг только per-task (`RoomTask.score`); нет
полноценного scorecard / rubric; финальный verdict
(`strong-hire/hire/no-hire/strong-no-hire`) — **в разработке** (см. FR-10);
personal notes — свободный markdown.

**ATS / HR-интеграции**: нет webhooks / events bus / outbox для Greenhouse /
HireFlow / Huntflow / E-Staff; нет экспорта в HR-стандарты; Linear sync —
только для внутренних задач разработки, не HR.

**Межкомандный обмен данными о кандидате**: комната ≠ устойчивый профиль
кандидата; нет shared candidate pool; нет блэклиста списывающих между
командами.

**Приглашения и расписание**: нет email / SMS (URL передаётся вручную); нет
SMTP; нет calendar / scheduling; нет `Room.scheduledAt` /
`expectedDurationMinutes` / `status`.

**Чат / голос / видео**: общий public-канал чата отсутствует; WebRTC нет.

**Миграции БД**: `ddl-auto: update`, никаких Flyway / Liquibase.

**Rate-limit / DoS-защита**: нет bucket4j / resilience4j.

**Realtime scaling**: in-memory state в `ConcurrentHashMap` JVM-инстанса; нет
Redis pub/sub, нет sticky session, нет шардирования; горизонтально не
масштабируется.

**Spring Security**: подключён только `spring-security-crypto`; HTTP filter
chain не сконфигурирован; авторизация — вручную в каждом контроллере; сессии
в `user_sessions` без `expires_at` / cleanup-задачи.

**Agent platform пробелы**: `TemporalWorkflowProvider` и
`LangGraphWorkflowProvider` — in-memory заглушки; 4 reviewer-рантайма —
эвристики над artifactTypes, не LLM-вызовы; pgvector-таблица под embedding
есть, но запись эмбеддингов не реализована.

---

## 4. Функциональные требования

### FR-1 Room lifecycle
Любой пользователь может создать комнату (гостем или из кабинета); комната
хранит `owner_session_token` и опц. `interviewer_session_token`; участник
заходит по `inviteCode` (URL `/room/{inviteCode}`); метаданные комнаты:
`language`, `currentStep`, `code`, `tasks[]`, `notes`, `interviewerChat`,
`privateNotesJson`, `briefingMarkdown`, `candidateKeyHistory`,
`yjsDocumentBase64`.

### FR-2 Realtime collaboration
Редактирование кода синхронизируется через Yjs CRDT + SSE; presence
(active/away), курсоры, awareness; reconnect восстанавливает полный snapshot
через `request_state_sync`; dedupe по `operationId`.

### FR-3 Interview steps
Комната содержит упорядоченный список `RoomTask`; `OWNER` / `INTERVIEWER`
могут переключать шаг (`POST /next-step`, realtime `next_step` / `set_step`);
при смене шага редактор подставляет `starterCode` нового шага; `solutionCode`
последнего шага сохраняется при `code_update`.

### FR-4 Permissions
Все owner/interviewer-only действия валидируются на backend; роль резолвится
через `RoomAccessService.resolveAccess`; изменение роли участника
бродкастится realtime.

### FR-5 Code editor
CodeMirror 6 с подсветкой для JS/TS, Python, Java, SQL; Kotlin — без подсветки
(нет граммара); plain text как fallback / для not-tech раундов; переключение
языка владельцем — всем участникам.

### FR-6 Personal cabinet
Регистрация / логин по нику; dashboard с разделами `rooms`, `tasks`, `manage`,
опц. `agents`, `admin`; CRUD банка задач (категории + шаблоны).

### FR-7 Guest flow
Комната создаётся с landing без регистрации; клиент получает invite-URL +
`owner_session_token`; сразу заходит в комнату.

### FR-8 Anti-cheat сигналы (зачаточные)
Захват keydown / tab-switch / focus-events у кандидата; буфер 50 событий,
видимый интервьюеру в моменте; экспорт пока только через personal notes.

### FR-9 Agent orchestration API (внутренний)
`POST /api/agent/runs` обязательно требует `linearIssueId`; state machine
BACKLOG→…→DONE с policy gates; artifact registry, verdicts, trace events;
Environment Doctor для проверки локальной среды.

### FR-10 Финальный verdict (#7, F-021)

**Продуктовый контекст**: на сегодня итог интервью существует только в виде
free-form personal notes. Нет структурированного решения «брать / не брать»,
поэтому данные нельзя агрегировать для аналитики воронки найма и calibration.

**Требования**:

- Вводится ENUM `InterviewVerdict`: `STRONG_HIRE` / `HIRE` / `NO_HIRE` /
  `STRONG_NO_HIRE`.
- Новые поля в `Room`: `verdict: String? = null`, `verdictComment: TEXT? = null`,
  `status: String = "active"` (значения `active` | `finished`).
- Новый REST endpoint `POST /api/rooms/{inviteCode}/verdict`, тело
  `{ verdict: String, comment: String }`. Доступен **только** для роли
  `OWNER` / `INTERVIEWER` (`canManageRoom = true`); комментарий обязателен,
  длина ≥ 10 символов; `verdict` должен входить в `InterviewVerdict`. После
  успешного сохранения комната переходит в `status = "finished"`.
- `GET /api/rooms/{inviteCode}` и `RoomResponse` дополняются полями `verdict`,
  `verdictComment`, `status`.
- `RoomSummaryDto` дополняется полями `verdict`, `status`.
- Realtime broadcast при сохранении verdict: новое событие `verdict_set` с
  payload `{ verdict, verdictComment, status: "finished" }` всем участникам
  комнаты (через тот же SSE-канал).
- Frontend: кнопка «Завершить интервью» (рендерится только при
  `canManageRoom = true`) открывает Mantine Modal — `Radio` с 4 опциями +
  `TextArea` для обязательного комментария (≥ 10 символов) + кнопка
  «Сохранить». После сохранения в заголовке комнаты показывается badge со
  статусом verdict.
- **Зависимости**: нет.

### FR-11 Paste detection (#19, F-013)

**Продуктовый контекст**: вставка из буфера в CodeMirror 6 сейчас не отличается
от ручного ввода. Это самая массовая форма списывания и она детектируется
надёжно без ML.

**Требования**:

- Frontend: обработчик `paste` вешается на `EditorView` через
  `EditorView.domEventHandlers({ paste: ... })` в `RoomCodeEditor.tsx`.
- При вставке отправляется realtime-событие type `candidate_key`,
  `eventKind = "paste"` + новые поля `pasteLength: number` (длина вставленного
  текста) и `pastePreview: string` (первые 50 символов).
- Backend:
  - В `RealtimeEventRequest` добавляются `pasteLength: Int? = null`,
    `pastePreview: String? = null`.
  - В `CandidateKeyPayload` (`WsMessages.kt`) добавляются `pasteLength: Int? = null`,
    `pastePreview: String? = null`.
  - `normalizeEventKind()` (`CandidateKeyHistoryHelpers.kt`) принимает `paste`
    как валидный `eventKind`.
  - Paste-события хранятся в `Room.candidateKeyHistory` наравне с `keydown`
    (общий лимит 50 событий).
- Realtime broadcast: paste-события идут тем же путём, что и прочие
  `candidate_key`, и доставляются интервьюерам.
- UI интервьюера: в таймлайне истории клавиш для `eventKind = paste`
  показывается специальная иконка и `pastePreview`.
- Захват только у роли `CANDIDATE` (как у остальных key-events).
- **Зависимости**: нет.

### FR-12 Полный keystroke timeline + экспорт (#5, F-026)

**Продуктовый контекст**: текущий буфер в 50 событий — это ≈ 10 секунд
активного кодирования. Этого недостаточно для доказательной базы, аналитики
паттернов поведения и формирования блэклиста списывающих.

**Требования**:

- Новая JPA entity `RoomKeystrokeEvent` + таблица `room_keystroke_events`
  (схема — см. раздел 6 «Persistence»). Индексы:
  `(room_id, timestamp_epoch_ms)` и `(room_id, session_id)`. FK на `rooms.id`
  без cascade delete (чтобы очистка событий не роняла комнаты).
- BatchPersistence в `CollaborationService`: события накапливаются в
  `ConcurrentLinkedQueue`, flush — каждые 100 событий или каждые 5 секунд через
  существующий `ScheduledExecutorService`. Flush выполняется в отдельной
  транзакции, чтобы не блокировать realtime-flow.
- В новую таблицу сохраняются **все** candidate key-events (`keydown`,
  `window_blur`, `tab_hidden`, `tab_visible`, `window_focus`, `paste`)
  параллельно с in-memory буфером 50 событий (буфер остаётся для real-time
  отображения в UI).
- Новые REST endpoints (авторизация: только `OWNER` / `INTERVIEWER`):
  - `GET /api/rooms/{inviteCode}/keystroke-events` → JSON-массив всех событий,
    сортировка по `timestamp_epoch_ms` ASC.
  - `GET /api/rooms/{inviteCode}/keystroke-events?format=csv` → CSV с
    заголовком.
- Frontend: новая панель/вкладка «Activity Timeline» в `RoomPage`, видна только
  при `canManageRoom = true`: список событий с иконками по `eventKind`,
  `timestamp`, `displayName`; кнопки «Экспорт JSON» / «Экспорт CSV».
- Retention policy: данные хранятся 12 месяцев (cleanup — scheduled job или
  ручная задача).
- **Зависимости**: FR-11 (paste detection — чтобы paste-события также попадали
  в timeline).

---

## 5. Нефункциональные требования

### NFR-1 Latency
Editor update propagation: <300 мс в одном регионе при обычной нагрузке.

### NFR-2 Consistency
Основной режим: Yjs CRDT (eventual consistency, automatic conflict resolution);
fallback: server-authoritative LWW по `codeSequence`.

### NFR-3 Availability
Reconnect в 30 с восстанавливает последнее состояние; in-memory state НЕ
переживает рестарт процесса (текущее ограничение).

### NFR-4 Security
BCrypt для паролей; session-token авторизация (без TTL — техдолг); ручная
авторизация в контроллерах; CORS — whitelist origin; админ-bypass `boumrz` на
фронте — техдолг.

### NFR-5 Observability
Structured-логи (SLF4J + Logback); `agent_trace` формат для агентских
событий; Яндекс Метрика на фронте; OpenTelemetry API подключён, экспортёр не
сконфигурён.

### NFR-6 Cost / footprint
Один JVM-инстанс backend; PostgreSQL 16 prod, H2
in-memory для local-dev.

---

## 6. Архитектура

### Frontend
React 18 + TypeScript 5; Redux Toolkit + RTK Query; UI — **Mantine 7**;
Routing — react-router-dom 6; Bundler — **Rspack**; Editor — **CodeMirror 6**
(НЕ Monaco); CRDT — Yjs + y-protocols + y-codemirror.next; Export — jspdf;
E2E — Playwright + кастомные `e2e-*.mjs`-харнессы; Build — Brotli + Gzip
precompress.

### Backend
**Kotlin 1.9.25 + Spring Boot 3.3.5 + Java 17**; две параллельные сборки:
Maven (`pom.xml`) и Gradle (`build.gradle.kts`) — техдолг; JPA + Hibernate,
`ddl-auto: update`; `spring-boot-starter-security` НЕ подключён (только
crypto-модуль для BCrypt); Spring RestClient для Linear API; OpenTelemetry API
1.48 (без экспортёра).

### Persistence
Prod: PostgreSQL 16; local: H2 in-memory в PostgreSQL-mode; pgvector — опц.,
для `agent_artifacts.embedding`; **Redis НЕ используется** (вопреки CLAUDE.md).

Новая таблица для полного keystroke timeline (FR-12), создаётся через
`ddl-auto: update`:

```
room_keystroke_events(
  id                 UUID PK,
  room_id            TEXT NOT NULL,        -- FK rooms.id, без cascade delete
  session_id         TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  event_kind         TEXT NOT NULL,        -- keydown|window_blur|tab_hidden|tab_visible|window_focus|paste
  key                TEXT,
  key_code           TEXT,
  ctrl_key           BOOLEAN DEFAULT FALSE,
  alt_key            BOOLEAN DEFAULT FALSE,
  shift_key          BOOLEAN DEFAULT FALSE,
  meta_key           BOOLEAN DEFAULT FALSE,
  paste_length       INT,
  paste_preview      TEXT,
  timestamp_epoch_ms BIGINT NOT NULL,
  created_at         TIMESTAMP DEFAULT NOW()
)
-- индексы: (room_id, timestamp_epoch_ms), (room_id, session_id)
```

Поля `rooms`, добавляемые для FR-10: `verdict TEXT NULL`,
`verdict_comment TEXT NULL`, `status TEXT NOT NULL DEFAULT 'active'`.

### Realtime transport
**SSE** на `text/event-stream`; POST events для исходящих от клиента;
**WebSocket НЕ используется** (location `/ws/` в nginx ведёт в никуда).

### Deploy
Systemd unit `interview-online-backend.service`; nginx subdomain
`interview.domiknote.ru`; Let's Encrypt через Certbot; Brotli / Gzip на
frontend assets; SSE-friendly nginx-конфиг (no buffering, 1h timeout).

---

## 7. Модель данных (high-level)

### Базовые

- `users(id, nickname unique, display_name, password_hash, role, created_at)`
- `user_sessions(id, user_id, token unique, created_at)` — без `expires_at`
- `rooms(id, title, invite_code unique, owner_session_token,
  interviewer_session_token, owner_user_id nullable, language, current_step,
  code, notes, interviewer_chat, briefing_markdown, candidate_key_history,
  private_notes_json, created_at)`
- `room_tasks(id, room_id, step_index, title, description, starter_code,
  solution_code, interviewer_notes, private_notes_json, briefing_markdown,
  solution_language, score, source_task_template_id, language, category_name)`
- `room_participants(id, room_id, user_id, role, created_at)` — unique (room, user)
- `user_task_categories(id, owner_user_id, name, created_at)`
- `user_task_templates(id, owner_user_id, category_id, title, description,
  starter_code, language, created_at)`

### Agent platform

- `agent_task_runs(id, linear_issue_id, workflow_provider, workflow_name,
  current_state, requires_human_approval, human_approved, retry_count,
  max_retries, timeout_seconds, assigned_role, trace_id, acceptance_criteria
  jsonb, context_payload jsonb)`
- `agent_artifacts(id, run_id, linear_issue_id, artifact_type, artifact_key,
  schema_version, payload jsonb, embedding vector(1536) nullable)`
- `agent_review_verdicts(id, run_id, reviewer_type, decision, is_blocking, ...)`
- `agent_trace_events(id, run_id, trace_id, span_name, event_type, payload jsonb, created_at)`

### Чего нет

`candidate_profiles`, `interview_results` / `scorecards`,
`interview_recordings` / `replay_events`, `companies` / `teams`,
`email_invitations` / `notifications`, `interview_slots` / `schedule`.

---

## 8. API contracts (актуальные)

### Public / Health / Auth
- `GET  /api/public/health`
- `POST /api/auth/register`
- `POST /api/auth/login`

### Rooms
- `POST   /api/public/rooms`
- `POST   /api/rooms`
- `GET    /api/rooms/{inviteCode}`
- `POST   /api/rooms/{inviteCode}/next-step`
- `POST   /api/rooms/{inviteCode}/tasks`
- `PATCH  /api/rooms/{inviteCode}/tasks/{stepIndex}`
- `DELETE /api/rooms/{inviteCode}/tasks/{stepIndex}`
- `GET    /api/rooms/{inviteCode}/participants`
- `POST   /api/rooms/{inviteCode}/participants/{userId}/role`

### Me / Account
- `GET/PATCH /api/me/profile`
- `GET/PATCH/DELETE /api/me/rooms[/{roomId}]`
- `GET/POST/PATCH/DELETE /api/me/tasks[/{taskId}]`

### Admin
- `GET /api/admin/users`
- `PATCH /api/admin/users/{userId}/role`
- `DELETE /api/admin/users/{userId}`

### Realtime
- `GET  /api/realtime/rooms/{inviteCode}/stream` (SSE)
- `POST /api/realtime/rooms/{inviteCode}/events`

### Agent platform
- `GET /api/agent/providers`
- `POST /api/agent/runs`
- `GET /api/agent/runs/{runId}`
- `POST /api/agent/runs/{runId}/transition`
- `POST /api/agent/runs/{runId}/verdicts`
- `POST /api/agent/runs/{runId}/reviewers/{reviewerType}/execute`
- `POST /api/agent/runs/{runId}/reviewers/execute-all`
- `POST /api/agent/runs/{runId}/artifacts`
- `GET /api/agent/issues/{linearIssueId}/runs`
- `GET /api/agent/issues/{linearIssueId}/artifacts`
- `GET /api/agent/runs/{runId}/policy`
- `GET /api/agent/runs/{runId}/trace`
- `GET /api/agent/environment/doctor`
- `POST/DELETE /api/agent/realtime/faults/{inviteCode}`

---

## 9. Acceptance criteria (текущие, для регрессии)

- AC-1: гость создаёт комнату с лэндинга и сразу попадает в неё.
- AC-2: второй участник заходит по link и видит тот же код.
- AC-3: правки одного участника видны другим в real-time (Yjs).
- AC-4: владелец переключает язык — всем применяется.
- AC-5: владелец переключает шаг — редактор подгружает `starterCode`.
- AC-6: не-owner не может выполнить owner-only действия (backend проверка).
- AC-7: интервьюер видит лог последних 50 keydown / focus-событий кандидата.
- AC-8: зарегистрированный юзер видит список своих комнат в `/dashboard/rooms`.
- AC-9: кастомные задачи из банка применяются к новой комнате.
- AC-10: экспорт personal notes в Markdown и PDF работает.
- AC-11: при reconnect клиент получает `state_sync` со всем содержимым комнаты.
- AC-12: agent-run с включённым Linear sync создаёт issue в Linear.
- AC-13: policy gates блокируют переход в QA / DONE без обязательных artifacts.

---

## 10. Открытые риски и техдолг

### Архитектурные
1. Realtime in-memory state — не масштабируется горизонтально.
2. `CollaborationService` — god-object на ~1800 строк.
3. Двойная сборка backend (Maven + Gradle).
4. `ddl-auto: update` без миграций.
5. Spring Security HTTP filter chain не сконфигурирован.

### Безопасность
7. Сессии без TTL / expires_at, без cleanup.
8. Hardcoded admin-bypass `boumrz` на фронте.
9. Нет rate-limit / DoS-защиты на `POST /events`.
10. OTel API без экспортёра — трейсы пропадают.

### Продуктовые (важно для воронки найма)
11. Нет identity кандидата → нет cross-team shared pool, нет блэклиста списывающих.
12. Нет scorecard / rubric / verdict.
13. Нет видеозаписи / реплея coding.
14. Anti-cheat слабый: 50 keydown, нет paste detection, нет AI-детекции.
15. Нет ATS / HR-интеграций.
16. Нет приглашений (email / SMS).
17. Нет calendar / scheduling.

### Документация
18. CLAUDE.md / AGENTS.md содержат устаревшие утверждения (Monaco, WebSocket,
    Redis) — нужно синхронизировать с этой спекой.

---

## 11. Ссылки на ключевые места кода (cheat sheet)

| Зона | Файл |
|------|------|
| Главный realtime god-сервис | `backend/src/main/kotlin/com/interviewonline/service/CollaborationService.kt` |
| REST контроллеры | `backend/src/main/kotlin/com/interviewonline/controller/*.kt` |
| Модели Entity | `backend/src/main/kotlin/com/interviewonline/model/*.kt` |
| Realtime DTO | `backend/src/main/kotlin/com/interviewonline/ws/{RealtimeEventRequest, WsMessages}.kt` |
| Конфиг | `backend/src/main/resources/{application.yml, application-local.yml, policy-gates.json}` |
| Frontend entry | `frontend/src/main.tsx`, `frontend/src/app/App.tsx` |
| API client | `frontend/src/services/api.ts` |
| Метрика | `frontend/src/services/analytics.ts` |
| Realtime hook | `frontend/src/features/room/useRoomSocket.ts` |
| Editor | `frontend/src/features/room/RoomCodeEditor.tsx` |
| Anti-cheat tracker | `frontend/src/features/room/useCandidateKeyTracker.ts`, `candidateKeys.ts` |
| Deploy | `deploy/nginx/interview-online-subdomain.conf`, `deploy/systemd/interview-online-backend.service` |
| Agent роли | `.claude/agents/*.md`, `agents/roles/*.md`, `agents/common/*.md` |

---

## 12. Связанные документы

- `README.md` — quick start, env vars.
- `MULTI_AGENT_SYSTEM.md` — концепция многоагентной системы разработки.
- `AGENT_PROMPTS.md` — system prompts всех агентов.
- `LINEAR_BOOTSTRAP.md` — настройка Linear sync.
- `AGENTS.md` — контракт для Codex / OpenAI агентов (committed).
- `CLAUDE.md` — локальные инструкции для Claude (gitignored).
- `analytics/` — артефакты анализа влияния на воронку найма (gitignored).
