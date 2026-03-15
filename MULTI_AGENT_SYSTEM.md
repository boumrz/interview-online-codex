# Мультиагентная система разработки

## 1. Цель системы

Построить команду агентов, которая может начать и вести разработку платформы для технических собеседований с совместным редактированием кода в реальном времени.

Продукт:
- комнаты для интервью по ссылке;
- совместное редактирование кода в реальном времени;
- пошаговое интервью с переключением задач;
- запуск кода только владельцем комнаты;
- личный кабинет;
- возможность создавать комнаты без регистрации;
- фронтенд на React + TypeScript + RTK + RTK Query + CSS Modules + Rspack;
- бэкенд на Kotlin + PostgreSQL;
- дополнительные технологии выбирает архитектор.

## 2. Принцип работы системы

Система строится не как набор "равноправных" агентов, а как управляемая иерархия:

1. `Specification (TZ) Agent` формирует ТЗ по исходному описанию.
2. `Product Owner` формулирует, уточняет и приоритизирует требования.
3. `Architect` проектирует техническое решение.
4. `Team Lead` декомпозирует работу, назначает исполнителей и контролирует качество поставки.
5. Исполнительные агенты (`Developer`, `Designer`, `QA`) создают артефакты.
6. Независимые проверяющие агенты валидируют решения основных агентов и блокируют плохие handoff.
7. `Linear` используется как единая система постановки задач, статусов, приоритетов и связи артефактов разработки.

Это нужно, чтобы агентная система не вырождалась в хаотичную генерацию кода без архитектуры, продуктовой логики и верификации.

## 2.1. Роль Linear в системе

`Linear` является обязательным operational layer для всей мультиагентной команды.

Что хранится в `Linear`:
- эпики;
- проекты;
- user stories;
- инженерные задачи;
- подзадачи;
- баги;
- риски и blockers;
- ссылки на архитектурные и дизайн-артефакты;
- решения по review.

Как используется `Linear`:
- `Product Owner` ведет эпики, user stories и приоритеты;
- `Team Lead` формирует milestones, спринты и task breakdown;
- `Architect` добавляет ADR-linked technical tasks и spikes;
- `Developer`, `Designer`, `QA` работают только по задачам, созданным в `Linear`;
- проверяющие агенты оставляют review verdict и blocking findings как комментарии или связанные issues;
- состояние задачи в агентной системе должно совпадать со статусом issue в `Linear`.

Минимальная структура `Linear`:
- Team: `Interview Platform`
- Projects:
  - `MVP Foundation`
  - `Realtime Collaboration`
  - `Code Execution`
  - `Account & Templates`
  - `Release Hardening`
- Labels:
  - `frontend`
  - `backend`
  - `realtime`
  - `design`
  - `qa`
  - `security`
  - `architecture`
  - `product`
  - `blocked`
  - `mvp`

Рекомендуемые статусы `Linear`:
- `Backlog`
- `Refinement`
- `Ready`
- `In Progress`
- `In Review`
- `QA`
- `Done`
- `Blocked`

## 3. Состав агентов

### Основные агенты

#### 3.0. Specification (TZ) Agent
Зона ответственности:
- формирует структурированное ТЗ из свободного описания задачи;
- фиксирует scope, ограничения и допущения;
- формализует функциональные и нефункциональные требования;
- задает измеримые acceptance criteria на уровне требований;
- выявляет пробелы и конфликтующие требования до архитектуры и декомпозиции.

Вход:
- исходное описание проекта;
- бизнес-цели;
- ограничения стека;
- уточнения от Product Owner и Architect.

Выход:
- документ ТЗ;
- список open questions;
- список initial задач для Product Owner, Architect и Team Lead.

KPI:
- ТЗ достаточно, чтобы Team Lead начал decomposition без критических пробелов;
- требования не содержат непроверяемых формулировок.

#### 3.1. Product Owner Agent
Зона ответственности:
- формирует vision продукта;
- описывает user stories и acceptance criteria;
- определяет MVP;
- расставляет приоритеты в backlog;
- принимает результат этапа с точки зрения бизнес-ценности.

Вход:
- исходная постановка задачи;
- вопросы от Team Lead, Architect, Designer, QA.

Выход:
- PRD-lite;
- roadmap;
- backlog эпиков и user stories;
- definition of done на уровне продукта.

KPI:
- требования непротиворечивы;
- у каждой задачи есть ценность, границы и критерии приемки.

#### 3.2. Architect Agent
Зона ответственности:
- проектирует общую архитектуру системы;
- выбирает дополнительные технологии;
- определяет границы сервисов и модулей;
- проектирует real-time collaboration;
- определяет модель данных, API, безопасность, масштабирование.

Вход:
- требования от Product Owner;
- ограничения стека.

Выход:
- architecture decision records;
- C4-lite схема;
- модель данных;
- контракты API;
- стратегия real-time синхронизации;
- NFR: latency, consistency, resilience, observability.

KPI:
- решение реализуемо в выбранном стеке;
- архитектура покрывает реальные сценарии интервью.

#### 3.3. Team Lead Agent
Зона ответственности:
- превращает архитектуру и требования в рабочий план;
- делит проект на milestones, streams, задачи;
- назначает владельцев задач;
- контролирует зависимости, риски и качество handoff;
- принимает инженерные решения на уровне delivery.

Вход:
- backlog от PO;
- архитектура от Architect;
- оценки и риски от исполнителей.

Выход:
- delivery plan;
- sprint backlog;
- task breakdown;
- dependency map;
- release plan MVP.

KPI:
- нет блокирующих зависимостей;
- задачи достаточно малы для автономного выполнения агентами.

#### 3.4. Developer Agent
Зона ответственности:
- реализует frontend и backend задачи;
- пишет код, миграции, API, интеграции;
- добавляет unit/integration тесты;
- документирует изменения на инженерном уровне.

Вход:
- задачи от Team Lead;
- дизайн и архитектурные артефакты;
- замечания от QA и проверяющих агентов.

Выход:
- код;
- тесты;
- технические notes;
- changelog задачи.

KPI:
- код проходит quality gates;
- изменения соответствуют acceptance criteria и architecture guardrails.

#### 3.5. Designer Agent
Зона ответственности:
- проектирует UX пользовательских потоков;
- создает wireframes и UI-spec;
- описывает поведение экранов, состояний и компонентов;
- задает визуальные и interaction-правила для frontend.

Вход:
- продуктовые сценарии;
- ограничения frontend-стека;
- вопросы от Developer и QA.

Выход:
- user flows;
- screen specs;
- component inventory;
- дизайн состояния real-time комнаты;
- спецификация empty/loading/error states.

KPI:
- интерфейс покрывает ключевые сценарии интервью;
- нет критических UX-дыр в room flow и lobby/account flow.

#### 3.6. QA Agent
Зона ответственности:
- строит тестовую стратегию;
- пишет test cases;
- проверяет функциональность, регресс, edge cases;
- валидирует сценарии real-time collaboration и code execution.

Вход:
- acceptance criteria;
- код и UI-spec;
- архитектурные ограничения.

Выход:
- test strategy;
- test matrix;
- баг-репорты;
- release readiness verdict.

KPI:
- покрыты happy path, negative path, race conditions, permission rules.

### Дополнительные проверяющие агенты

#### 3.7. Solution Reviewer Agent
Независимо проверяет решения Developer и Architect.

Проверяет:
- архитектурную целостность;
- соответствие стека;
- технические риски;
- избыточную сложность;
- нарушение non-functional требований.

Результат:
- `approve / revise / reject` с аргументацией.

#### 3.8. Prompt/Task Auditor Agent
Проверяет качество формулировки задач перед исполнением.

Проверяет:
- есть ли цель;
- есть ли входные данные;
- есть ли acceptance criteria;
- нет ли конфликтов между агентами;
- достаточно ли контекста для автономного выполнения.

Результат:
- задача возвращается на доуточнение либо пропускается в работу.

#### 3.9. Security & Reliability Agent
Независимо валидирует решения по безопасности и надежности.

Проверяет:
- авторизацию на уровне room owner;
- безопасность запуска кода;
- временные ссылки в комнаты;
- rate limiting;
- sandboxing code execution;
- хранение секретов;
- устойчивость real-time каналов.

Результат:
- security checklist;
- список обязательных remediation items.

#### 3.10. Test Reviewer Agent
Проверяет QA и тестовое покрытие.

Проверяет:
- полноту test cases;
- наличие сценариев race condition;
- покрытие WebSocket/WebRTC fallback flow;
- корректность permission testing;
- smoke/regression matrix.

Результат:
- verdict по качеству тестирования.

#### 3.11. UX Critic Agent
Проверяет решения Designer и frontend delivery.

Проверяет:
- понятность сценария "создать комнату без регистрации";
- ясность ролей в комнате;
- заметность текущего шага интервью;
- конфликтующие действия владельца и кандидата;
- удобство мобильного и desktop режима.

Результат:
- UX issues list;
- замечания до релиза.

## 4. Оркестрация агентов

## 4.1. Главный контур

```text
User Input
  -> Specification (TZ) Agent
  -> Product Owner
  -> Linear Epic/Issue creation
  -> Architect
  -> Team Lead
  -> Task Auditor
  -> Executor Agent (Developer / Designer / QA)
  -> Reviewer Agents
  -> Linear status/comment update
  -> Team Lead Final Check
  -> Product Owner Acceptance
```

## 4.2. Правила маршрутизации

- Для нового проекта или крупного изменения перед `Product Owner` сначала работает `Specification (TZ) Agent`.
- Все новые требования после ТЗ проходят через `Product Owner`.
- После первичного анализа `Product Owner` или `Team Lead` обязаны создать или обновить сущности в `Linear`.
- Ни одна техническая задача не попадает в `Developer`, пока `Architect` и `Team Lead` не выпустили решение и decomposition.
- Ни одна задача не стартует без проверки `Prompt/Task Auditor`.
- Ни одно решение не считается завершенным без независимой проверки профильным проверяющим агентом.
- `Team Lead` решает, нужна ли итерация назад.
- `Product Owner` принимает только пользовательскую ценность, а не качество кода.
- Если задача не отражена в `Linear`, она считается несуществующей для delivery-процесса.

## 4.3. Модель статусов задачи

Каждая задача проходит статусы:

`draft -> clarified -> designed -> planned -> in_progress -> under_review -> qa_check -> accepted -> done`

Дополнительные ветки:

- `rejected_architecture`
- `rejected_review`
- `blocked`
- `needs_clarification`

Соответствие статусам `Linear`:
- `draft`, `clarified` -> `Backlog` или `Refinement`
- `designed`, `planned` -> `Ready`
- `in_progress` -> `In Progress`
- `under_review` -> `In Review`
- `qa_check` -> `QA`
- `accepted`, `done` -> `Done`
- `blocked` -> `Blocked`

## 5. Артефакты системы

Для устойчивой работы агентам нужны общие типы документов.

### 5.1. Product artifacts
- `PRD`
- `User Stories`
- `Acceptance Criteria`
- `Prioritized Backlog`

### 5.2. Architecture artifacts
- `System Context`
- `Container Diagram`
- `Domain Model`
- `API Contracts`
- `ADR`
- `Realtime Sync Strategy`
- `Code Execution Strategy`

### 5.3. Delivery artifacts
- `Milestones`
- `Sprint Tasks`
- `Dependency Map`
- `Definition of Done`

### 5.4. Design artifacts
- `User Flow`
- `Screen Spec`
- `Component Spec`
- `State Matrix`

### 5.5. QA artifacts
- `Test Plan`
- `Test Cases`
- `Regression Suite`
- `Bug Reports`

### 5.6. Review artifacts
- `Architecture Review`
- `Security Review`
- `UX Review`
- `Test Coverage Review`

### 5.7. Linear artifacts
- `Epic`
- `Project`
- `Issue`
- `Sub-issue`
- `Comment thread`
- `Priority`
- `Estimate`
- `State transition history`

## 6. Роли агентов в вашем проекте

Ниже конкретизация команды под платформу технических интервью.

### 6.0. Specification (TZ) Agent для этого продукта

Главная задача:
- подготовить ТЗ по текущему описанию платформы до начала детализации у PO/Architect.

Структура ТЗ для этого продукта:
- цели платформы и границы MVP;
- роли и сценарии участников (владелец комнаты, кандидат, гость, зарегистрированный пользователь);
- функциональные требования по room/editor/steps/execution/account;
- non-functional требования (latency, reliability, security);
- ограничения стека;
- out-of-scope;
- acceptance criteria;
- список open questions.

### 6.1. Product Owner Agent для этого продукта

Главные эпики:
- гостевое создание комнаты без регистрации;
- регистрация и личный кабинет;
- real-time комната интервью;
- шаги интервью и выдача новой задачи;
- запуск кода владельцем;
- библиотека предзагруженных задач;
- история и управление комнатами в кабинете.

MVP-цель:
- создать комнату по ссылке;
- открыть совместный редактор;
- переключать шаги;
- очищать поле и выдавать новую задачу;
- запускать код от владельца;
- дать зарегистрированному пользователю личный кабинет;
- оставить быстрый вход без регистрации.

### 6.2. Architect Agent для этого продукта

Рекомендуемая архитектура:

- Frontend:
  - React + TypeScript;
  - RTK для UI/domain state;
  - RTK Query для API;
  - Monaco Editor;
  - WebSocket как основной real-time transport;
  - WebRTC data channels как опциональное ускорение peer-to-peer синхронизации при подтвержденной сложности/выгоде;
  - Rspack;
  - CSS Modules.

- Backend:
  - Kotlin + Spring Boot;
  - PostgreSQL;
  - Redis для presence, pub/sub и ephemeral room state;
  - WebSocket gateway;
  - OT/CRDT engine для совместного редактирования;
  - sandboxed code runner как отдельный сервис;
  - object storage не обязателен для MVP.

Архитектурное решение по совместному редактированию:
- Для MVP лучше брать `WebSocket + CRDT/OT` через сервер как источник консистентности.
- `WebRTC` рассматривать как optimization layer позже.
- Причина: для интервью важнее предсказуемость, контроль владельца комнаты, логирование и управляемость, чем минимально возможная задержка любой ценой.

Архитектурные модули:
- `identity`:
  - гостевой вход;
  - пользовательский вход;
  - выдача session token.
- `room`:
  - создание комнаты;
  - join по ссылке;
  - owner/follower session model.
- `collaboration`:
  - editor sync;
  - presence;
  - current language;
  - current interview step.
- `task-template`:
  - предзагруженные задачи;
  - выдача следующей задачи;
  - reset editor.
- `code-execution`:
  - запуск кода;
  - вывод результата;
  - ограничения по ресурсам.
- `account`:
  - список комнат;
  - шаблоны задач;
  - история.

### 6.3. Team Lead Agent для этого продукта

Потоки разработки:
- `Stream A`: foundation и auth/session;
- `Stream B`: room lifecycle;
- `Stream C`: real-time editor;
- `Stream D`: interview steps and tasks;
- `Stream E`: code execution;
- `Stream F`: dashboard/account;
- `Stream G`: QA, security, observability.

Milestones:

1. `M0: Discovery & Architecture`
2. `M1: Room creation and join flow`
3. `M2: Real-time collaborative editor`
4. `M3: Interview steps and task templates`
5. `M4: Owner-only code execution`
6. `M5: Account area and room management`
7. `M6: Hardening, QA, release`

### 6.4. Developer Agent для этого продукта

Подроли:
- `Frontend Developer Agent`
- `Backend Developer Agent`
- `Realtime Collaboration Engineer Agent`
- `Execution Sandbox Agent`

Если нужен только один агент-разработчик на старте, он должен брать задачи в порядке:
- room creation/join;
- editor shell;
- real-time sync;
- task step switching;
- owner-only execution;
- account flows.

### 6.5. Designer Agent для этого продукта

Ключевые сценарии для проектирования:
- создать комнату с корня сайта без регистрации;
- зайти в комнату по ссылке;
- отличить владельца комнаты от участника;
- видеть текущий шаг интервью;
- получить новую задачу без перезагрузки;
- выбрать язык редактора;
- увидеть статус запуска кода и результат;
- управлять комнатами из личного кабинета.

### 6.6. QA Agent для этого продукта

Критические сценарии тестирования:
- два пользователя одновременно редактируют код;
- владелец меняет шаг, у обоих обновляется состояние;
- только владелец видит/использует run action;
- гость может создать комнату;
- зарегистрированный пользователь видит свои комнаты в кабинете;
- разрыв соединения и восстановление не ломают сессию;
- новая задача очищает редактор и подставляет нужный шаблон;
- смена языка не ломает синхронизацию документа.

## 7. Контроль качества решений основных агентов

### 7.0. Проверка Specification (TZ) Agent
Проверяющие агенты:
- `Prompt/Task Auditor`
- `Solution Reviewer` для технически чувствительных разделов

Вопросы:
- ТЗ полное и непротиворечивое?
- есть ли тестируемые acceptance criteria?
- зафиксированы ли ограничения, допущения и out-of-scope?

### 7.1. Проверка Product Owner
Проверяющий агент: `Prompt/Task Auditor`

Вопросы:
- story проверяема?
- критерии приемки измеримы?
- story не противоречит архитектуре?

### 7.2. Проверка Architect
Проверяющие агенты:
- `Solution Reviewer`
- `Security & Reliability Agent`

Вопросы:
- есть ли архитектурный overengineering?
- решена ли консистентность редактора?
- безопасен ли запуск кода?
- учтены ли reconnect/replay сценарии?

### 7.3. Проверка Team Lead
Проверяющий агент: `Prompt/Task Auditor`

Вопросы:
- задачи атомарны?
- нет ли скрытых зависимостей?
- могут ли исполнители завершить их автономно?

### 7.4. Проверка Developer
Проверяющие агенты:
- `Solution Reviewer`
- `Security & Reliability Agent`
- `Test Reviewer Agent`

Вопросы:
- код следует архитектуре?
- нет ли нарушения permission model?
- добавлены ли тесты?
- нет ли регрессии в real-time flow?

### 7.5. Проверка Designer
Проверяющий агент: `UX Critic Agent`

Вопросы:
- понятна ли роль владельца комнаты?
- видны ли шаги интервью?
- нет ли лишних действий в критическом room flow?

### 7.6. Проверка QA
Проверяющий агент: `Test Reviewer Agent`

Вопросы:
- покрыты ли race conditions?
- покрыт ли reconnect?
- покрыты ли guest и account сценарии?

## 8. Схема коммуникации между агентами

Каждый handoff должен иметь единый контракт:

### 8.1. Task envelope

```yaml
id: TASK-###
title: short task title
goal: business or technical goal
context:
  product_area: room | editor | account | execution
  dependencies: []
inputs:
  docs: []
  api_contracts: []
constraints:
  stack: []
  architecture_rules: []
acceptance_criteria:
  - ...
deliverables:
  - ...
risks:
  - ...
owner_agent: ...
reviewer_agents:
  - ...
status: draft
linear:
  project: ...
  issue_id: ...
  state: ...
  labels: []
```

### 8.2. Review envelope

```yaml
task_id: TASK-###
reviewer: Solution Reviewer
verdict: approve | revise | reject
findings:
  - severity: high
    summary: ...
    recommendation: ...
blocking: true
linear_comment_required: true
```

## 8.3. Правила работы с Linear

- Каждый epic продукта должен существовать как отдельный `Linear Epic`.
- Каждая задача агента должна быть отдельным `Linear Issue`.
- Если задача слишком велика для одного handoff, `Team Lead` обязан разбить ее на `Sub-issues`.
- Любая блокировка фиксируется в `Linear` со статусом `Blocked`.
- Любое ревью с verdict `revise` или `reject` обязано оставлять комментарий в `Linear`.
- Ссылки на PRD, ADR, wireframes, API contracts и test plans должны прикрепляться к issue.
- У каждой задачи должен быть owner, priority и связь с project/milestone.
- Закрывать issue можно только после прохождения review и QA-гейтов.

## 9. Правила принятия решений

### 9.1. Кто имеет право финального решения
- продуктовый приоритет: `Product Owner`
- техническая архитектура: `Architect`
- delivery и sequencing: `Team Lead`
- release readiness: `QA + Team Lead`
- блокировка по security: `Security & Reliability Agent`

### 9.2. Правило эскалации
- если спор касается ценности функции: эскалация к `Product Owner`
- если спор касается реализации: к `Architect`
- если спор касается приоритета и порядка: к `Team Lead`
- если спор касается риска для production: блокирует `Security & Reliability Agent`

## 10. Начальный backlog для запуска разработки

Этот backlog должен быть заведен в `Linear` как набор эпиков и issues.

### Epic 1. Entry and identity
- guest room creation from landing
- registered sign-in/sign-up
- session creation for guest and user
- room link join flow

### Epic 2. Interview room
- create room
- join room by invite link
- room owner assignment
- participant presence

### Epic 3. Collaborative editor
- integrate Monaco
- language switching
- collaborative document sync
- cursor/presence synchronization
- reconnect handling

### Epic 4. Interview steps
- preload tasks
- switch current step
- clear editor and inject new task
- sync current step to all participants

### Epic 5. Code execution
- owner-only run
- execution API
- sandbox restrictions
- stdout/stderr/result view

### Epic 6. Personal account
- dashboard
- room history
- saved templates/tasks

### Epic 7. Reliability and release
- logs and metrics
- audit trail for room actions
- rate limits
- regression suite

## 11. MVP-порядок для мультиагентной команды

Если запускать команду прямо сейчас, порядок должен быть таким:

1. `Specification (TZ) Agent`
   - формирует и актуализирует ТЗ по исходному описанию.
   - создает initial `SPEC-*` issues в `Linear`.
2. `Product Owner Agent`
   - формирует MVP scope и acceptance criteria.
   - создает эпики и верхнеуровневые stories в `Linear`.
3. `Architect Agent`
   - принимает решения по real-time, code execution и модели данных.
   - создает architecture spikes и ADR-related issues в `Linear`.
4. `Designer Agent`
   - проектирует critical user flows и room UI.
   - ведет design tasks и прикладывает спецификации к issues.
5. `Team Lead Agent`
   - режет MVP на задачи по потокам.
   - настраивает sequencing, assignee и зависимости в `Linear`.
6. `Prompt/Task Auditor Agent`
   - валидирует постановки.
7. `Developer Agent`
   - реализует задачи инкрементами.
   - обновляет статус issues по мере выполнения.
8. `Solution Reviewer + Security Agent`
   - проверяют каждый существенный handoff.
   - оставляют review findings в `Linear`.
9. `QA Agent + Test Reviewer Agent`
   - подтверждают готовность к релизу.
   - переводят задачи в `QA` и затем в `Done` после проверки.
10. `Product Owner Agent`
   - принимает MVP.

## 12. Практическая рекомендация по реализации самой мультиагентной системы

Если эту систему реализовывать как программную оркестрацию, то лучше запускать ее в виде следующих сущностей:

- `Orchestrator`
  - хранит очередь задач;
  - вызывает агентов;
  - переводит задачу между статусами.
  - синхронизирует внутренние статусы с `Linear`.

- `Shared Memory`
  - backlog;
  - архитектурные решения;
  - glossary;
  - task envelopes;
  - review history.

- `Agent Runtime`
  - отдельный prompt profile на каждого агента;
  - ограничения по ответственности;
  - шаблон входа и выхода.

- `Policy Engine`
  - запрещает обход обязательных review-этапов;
  - валидирует обязательные артефакты;
  - блокирует merge без security/test verdict.
  - блокирует старт работы по задачам вне `Linear`.

Минимальный состав сущностей данных:
- `agents`
- `tasks`
- `artifacts`
- `reviews`
- `decisions`
- `task_transitions`
- `linear_links`

## 13. Что лучше выбрать сразу

Для вашего проекта рекомендованы следующие технические решения на старте:

- real-time transport: `WebSocket`
- sync algorithm: `CRDT` или mature OT implementation
- editor: `Monaco`
- backend framework: `Spring Boot`
- ephemeral coordination: `Redis`
- persistence: `PostgreSQL`
- execution runner: isolated worker/container sandbox
- observability: structured logs + metrics + tracing-lite

`WebRTC` не стоит брать в базовый MVP как обязательную основу. Его имеет смысл держать как отдельное архитектурное исследование после первого стабильного real-time прототипа.

## 14. Итоговая структура команды

Основные агенты:
- `Specification (TZ) Agent`
- `Product Owner Agent`
- `Architect Agent`
- `Team Lead Agent`
- `Developer Agent`
- `Designer Agent`
- `QA Agent`

Проверяющие агенты:
- `Prompt/Task Auditor Agent`
- `Solution Reviewer Agent`
- `Security & Reliability Agent`
- `Test Reviewer Agent`
- `UX Critic Agent`

Рекомендуемая управленческая цепочка:

```text
Specification/TZ
  -> Product Owner
  -> Linear backlog
  -> Architect
  -> Team Lead
  -> Executors
  -> Reviewers
  -> QA
  -> Product Owner acceptance
```

Эта схема подходит для запуска разработки вашего проекта без выделенной ролевой модели пользователей внутри продукта, но с жесткой ролевой моделью внутри самой агентной команды.

`Linear` в этой схеме является обязательной системой учета работ и должен использоваться всеми агентами как единый источник task-state.
