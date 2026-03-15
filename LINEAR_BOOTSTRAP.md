# Linear Bootstrap

## 1. Назначение

Этот документ задает стартовую структуру `Linear` для разработки платформы технических собеседований с мультиагентной командой.

Цель:
- быстро завести workspace delivery;
- разложить MVP на проекты, эпики и первые issues;
- связать задачи с агентами;
- синхронизировать `Linear` с мультиагентной системой.

## 2. Базовая конфигурация Linear

### Team
- `Interview Platform`

### Projects
- `MVP Foundation`
- `Realtime Collaboration`
- `Code Execution`
- `Account & Templates`
- `Release Hardening`

### Cycles
- `Cycle 01: Discovery & Foundation`
- `Cycle 02: Room & Collaboration MVP`
- `Cycle 03: Execution & Account`
- `Cycle 04: Hardening & Release`

### States
- `Backlog`
- `Refinement`
- `Ready`
- `In Progress`
- `In Review`
- `QA`
- `Done`
- `Blocked`

### Priorities
- `P0`: блокер MVP или критический риск
- `P1`: обязательно для MVP
- `P2`: желательно для MVP, но можно сдвинуть
- `P3`: post-MVP или optimization

### Labels
- `mvp`
- `product`
- `architecture`
- `frontend`
- `backend`
- `realtime`
- `design`
- `qa`
- `security`
- `infra`
- `blocked`
- `research`
- `guest-flow`
- `account`
- `room`
- `editor`
- `execution`

## 3. Mapping агентов на Linear

### Основные роли
- `Specification (TZ) Agent`
  - владеет issues типа `SPEC-*` и формирует ТЗ из исходного описания
- `Product Owner Agent`
  - владеет эпиками, story, приоритетами, acceptance criteria
- `Architect Agent`
  - владеет spikes, ADR-задачами, архитектурными рисками
- `Team Lead Agent`
  - владеет decomposition, sequencing, dependencies, issue hygiene
- `Developer Agent`
  - владеет implementation issues
- `Designer Agent`
  - владеет design issues и UI-spec tasks
- `QA Agent`
  - владеет test strategy, test design и bug verification

### Проверяющие роли
- `Prompt/Task Auditor Agent`
  - комментирует недостаточно сформулированные issues
- `Solution Reviewer Agent`
  - комментирует архитектурные и инженерные замечания
- `Security & Reliability Agent`
  - открывает blocking issues или комментарии по рискам
- `Test Reviewer Agent`
  - валидирует полноту тестовой стратегии
- `UX Critic Agent`
  - оставляет UX findings по design/frontend issues

## 4. Projects и их scope

### Project: MVP Foundation
Scope:
- product discovery;
- архитектура;
- identity/session;
- room creation/join;
- общий frontend/backend foundation.

Definition of done:
- можно создать комнату;
- можно зайти по ссылке;
- есть session model для гостя и пользователя;
- есть базовые архитектурные решения.

### Project: Realtime Collaboration
Scope:
- Monaco integration;
- collaborative sync;
- presence;
- language switching;
- reconnect behavior;
- interview steps sync.

Definition of done:
- два участника видят синхронный код;
- шаги и язык синхронизируются;
- reconnect не ломает комнату.

### Project: Code Execution
Scope:
- owner-only run;
- execution API;
- sandbox;
- stdout/stderr/result UI;
- resource limits.

Definition of done:
- только владелец запускает код;
- код выполняется в sandbox;
- пользователь видит результат выполнения.

### Project: Account & Templates
Scope:
- sign-in/sign-up;
- dashboard;
- room history;
- task templates;
- preloaded interview tasks.

Definition of done:
- зарегистрированный пользователь видит свои комнаты;
- может создавать комнаты из кабинета;
- доступны предзагруженные задачи.

### Project: Release Hardening
Scope:
- regression;
- security review;
- observability;
- performance checks;
- release readiness.

Definition of done:
- пройден QA gate;
- закрыты P0/P1 security findings;
- есть базовые метрики и журналы.

## 5. Стартовые Epic'и

### Epic 0. Technical Specification (TZ)
Project:
- `MVP Foundation`

Owner:
- `Specification (TZ) Agent`

Goal:
- сформировать ТЗ, достаточное для product/architecture decomposition.

Issues:
- `SPEC-01 Create full technical specification from project description`
- `SPEC-02 Resolve open questions and assumptions log`

### Epic 1. Product Discovery and MVP Scope
Project:
- `MVP Foundation`

Owner:
- `Product Owner Agent`

Goal:
- зафиксировать MVP и критерии приемки.

Issues:
- `PO-01 Define MVP scope for interview platform`
- `PO-02 Write user stories for guest and registered flows`
- `PO-03 Define acceptance criteria for room, editor, steps and execution`

### Epic 2. Core Architecture
Project:
- `MVP Foundation`

Owner:
- `Architect Agent`

Goal:
- выбрать техническую архитектуру MVP.

Issues:
- `ARCH-01 Select realtime collaboration strategy`
- `ARCH-02 Design backend modules and boundaries`
- `ARCH-03 Design room/session/domain model`
- `ARCH-04 Define API contracts for room lifecycle`
- `ARCH-05 Define code execution sandbox approach`

### Epic 3. Room Entry and Session Flow
Project:
- `MVP Foundation`

Owner:
- `Team Lead Agent`

Goal:
- обеспечить создание комнаты и вход по ссылке.

Issues:
- `TL-01 Break down guest room creation flow`
- `DEV-01 Implement guest session creation`
- `DEV-02 Implement room creation endpoint`
- `DEV-03 Implement room join by invite link`
- `DEV-04 Build landing room creation CTA`
- `DEV-05 Build room join page`

### Epic 4. Realtime Editor MVP
Project:
- `Realtime Collaboration`

Owner:
- `Team Lead Agent`

Goal:
- реализовать совместное редактирование кода.

Issues:
- `DEV-06 Integrate Monaco editor shell`
- `DEV-07 Implement realtime transport channel`
- `DEV-08 Implement collaborative document sync`
- `DEV-09 Implement participant presence state`
- `DEV-10 Implement reconnect and session restore`
- `DEV-11 Add language selector synced by room owner`

### Epic 5. Interview Steps and Task Templates
Project:
- `Realtime Collaboration`

Owner:
- `Product Owner Agent`

Goal:
- обеспечить пошаговое интервью и переключение задач.

Issues:
- `PO-04 Define task template structure`
- `ARCH-06 Define step state synchronization contract`
- `DEV-12 Implement current step state on backend`
- `DEV-13 Implement clear editor and inject new task flow`
- `DEV-14 Build owner controls for next task`

### Epic 6. Code Execution
Project:
- `Code Execution`

Owner:
- `Architect Agent`

Goal:
- реализовать безопасный запуск кода владельцем комнаты.

Issues:
- `ARCH-07 Define execution service interface`
- `DEV-15 Implement owner-only run permission`
- `DEV-16 Implement execution API`
- `DEV-17 Implement sandbox runner prototype`
- `DEV-18 Build execution result panel`

### Epic 7. Account and Dashboard
Project:
- `Account & Templates`

Owner:
- `Product Owner Agent`

Goal:
- дать пользователю личный кабинет и список комнат.

Issues:
- `DEV-19 Implement sign-in/sign-up flow`
- `DEV-20 Implement dashboard room list`
- `DEV-21 Implement create room from account area`
- `DEV-22 Implement task template management MVP`

### Epic 8. Design System and Critical UX
Project:
- `MVP Foundation`

Owner:
- `Designer Agent`

Goal:
- зафиксировать UX для ключевых сценариев.

Issues:
- `DES-01 Design landing guest room creation flow`
- `DES-02 Design interview room layout`
- `DES-03 Design owner controls for steps and execution`
- `DES-04 Design account dashboard`
- `DES-05 Produce UI state matrix for loading, error, reconnect`

### Epic 9. QA and Release Readiness
Project:
- `Release Hardening`

Owner:
- `QA Agent`

Goal:
- подготовить релизный контроль качества.

Issues:
- `QA-01 Create MVP test strategy`
- `QA-02 Define realtime collaboration regression matrix`
- `QA-03 Define permission and security test cases`
- `QA-04 Define reconnect and failure scenario suite`
- `QA-05 Prepare release readiness checklist`

## 6. Первые issues для немедленного старта

Эти задачи нужно создать в первую очередь. Они запускают всю мультиагентную цепочку.

### Batch A. Discovery

#### Issue: SPEC-01
- Title: `Create full technical specification from project description`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Specification (TZ) Agent`
- Labels: `product`, `architecture`, `mvp`
- Description:
  - оформить ТЗ по проекту;
  - зафиксировать функциональные и нефункциональные требования;
  - собрать open questions и assumptions.
- Deliverables:
  - TZ doc;
  - open questions log;
  - constraints and out-of-scope section.

#### Issue: PO-01
- Title: `Define MVP scope for interview platform`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Product Owner Agent`
- Labels: `product`, `mvp`
- Description:
  - зафиксировать MVP scope;
  - определить обязательные и отложенные функции;
  - сформулировать definition of success.
- Deliverables:
  - MVP scope doc;
  - release boundary;
  - exclusions list.

#### Issue: PO-02
- Title: `Write user stories for guest and registered flows`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Product Owner Agent`
- Labels: `product`, `mvp`, `guest-flow`, `account`

#### Issue: PO-03
- Title: `Define acceptance criteria for room, editor, steps and execution`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Product Owner Agent`
- Labels: `product`, `mvp`, `room`, `editor`, `execution`

### Batch B. Architecture

#### Issue: ARCH-01
- Title: `Select realtime collaboration strategy`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Architect Agent`
- Labels: `architecture`, `realtime`, `mvp`, `research`
- Description:
  - сравнить `WebSocket + server authoritative sync` и `WebRTC-first`;
  - выбрать стратегию для MVP;
  - описать tradeoffs.

#### Issue: ARCH-02
- Title: `Design backend modules and boundaries`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Architect Agent`
- Labels: `architecture`, `backend`, `mvp`

#### Issue: ARCH-03
- Title: `Design room/session/domain model`
- Project: `MVP Foundation`
- Priority: `P0`
- State: `Backlog`
- Assignee: `Architect Agent`
- Labels: `architecture`, `backend`, `room`, `guest-flow`

### Batch C. UX and decomposition

#### Issue: DES-01
- Title: `Design landing guest room creation flow`
- Project: `MVP Foundation`
- Priority: `P1`
- State: `Backlog`
- Assignee: `Designer Agent`
- Labels: `design`, `guest-flow`, `mvp`

#### Issue: DES-02
- Title: `Design interview room layout`
- Project: `MVP Foundation`
- Priority: `P1`
- State: `Backlog`
- Assignee: `Designer Agent`
- Labels: `design`, `room`, `editor`, `mvp`

#### Issue: TL-01
- Title: `Break down guest room creation flow`
- Project: `MVP Foundation`
- Priority: `P1`
- State: `Backlog`
- Assignee: `Team Lead Agent`
- Labels: `product`, `architecture`, `frontend`, `backend`, `mvp`
- Dependency:
  - starts after `SPEC-01`, `PO-01`, `PO-02`, `ARCH-03`

#### Issue: QA-01
- Title: `Create MVP test strategy`
- Project: `Release Hardening`
- Priority: `P1`
- State: `Backlog`
- Assignee: `QA Agent`
- Labels: `qa`, `mvp`
- Dependency:
  - starts after `PO-03`, `ARCH-01`

## 7. Sequential roadmap for Linear

### Phase 1. Clarify
- `SPEC-01`
- `PO-01`
- `PO-02`
- `PO-03`

Target state:
- `Done`

### Phase 2. Design
- `ARCH-01`
- `ARCH-02`
- `ARCH-03`
- `ARCH-04`
- `ARCH-05`
- `DES-01`
- `DES-02`
- `DES-03`

Target state:
- `Done`

### Phase 3. Plan
- `TL-01`
- decomposition of `DEV-01` to `DEV-10`
- issue linking and dependency graph

Target state:
- `Ready`

### Phase 4. Build MVP core
- `DEV-01` to `DEV-14`

Target state:
- `In Review` then `QA`

### Phase 5. Build account and execution
- `DEV-15` to `DEV-22`

### Phase 6. Harden
- `QA-01` to `QA-05`
- security findings
- performance checks

## 8. Recommended issue templates

### Template: Product Story
- Goal
- User
- Scenario
- Acceptance criteria
- Exclusions
- Links to related epics

### Template: Architecture Spike
- Problem statement
- Constraints
- Options considered
- Decision
- Tradeoffs
- Impact on frontend/backend/realtime

### Template: Delivery Task
- Goal
- Inputs
- Dependencies
- Acceptance criteria
- Deliverables
- Reviewer agents

### Template: Review Issue
- Reviewed issue
- Verdict
- Blocking or non-blocking
- Findings
- Required follow-up

### Template: QA Issue
- Scope
- Test cases
- Preconditions
- Expected result
- Regression impact

## 9. Workflow rules inside Linear

### State rules
- `Backlog`: issue создан, но не готова к работе
- `Refinement`: идет уточнение требований или границ
- `Ready`: задача полна по контексту и может быть взята агентом
- `In Progress`: агент выполняет задачу
- `In Review`: задача ушла на reviewer agents
- `QA`: задача проходит тестовую проверку
- `Done`: есть acceptance и закрыты обязательные замечания
- `Blocked`: задача остановлена из-за внешней или внутренней зависимости

### Mandatory rules
- Нельзя переводить issue в `In Progress`, пока нет acceptance criteria.
- Нельзя переводить issue в `Done`, пока нет review verdict и QA verdict для engineering tasks.
- Любой `reject` от reviewer создает или обновляет blocking comment.
- Любой P0 security finding автоматически переводит связанную задачу в `Blocked`.
- Если issue больше чем на 2 handoff, `Team Lead Agent` должен разбить ее на sub-issues.

## 10. Связь с мультиагентной системой

`Linear` и внутренняя мультиагентная система синхронизируются так:

- `draft` -> `Backlog`
- `clarified` -> `Refinement`
- `designed` / `planned` -> `Ready`
- `in_progress` -> `In Progress`
- `under_review` -> `In Review`
- `qa_check` -> `QA`
- `accepted` / `done` -> `Done`
- `blocked` -> `Blocked`

Каждый агент должен:
- брать задачу только из `Linear`;
- оставлять результаты в виде комментария или attached artifact;
- ссылаться на связанные issues и эпики;
- обновлять статус после handoff.

## 11. Что стоит завести в Linear сразу вручную

1. Team `Interview Platform`.
2. Все 5 projects из этого документа.
3. Labels и states.
4. 9 epic'ов.
5. Batch A, B, C как первые issues.
6. Dependencies между `PO`, `ARCH`, `DES`, `TL`, `QA`.

## 12. Следующий шаг

После заведения этой структуры в `Linear` логично подготовить:
- комплект системных промптов для всех агентов;
- issue templates в формате, удобном для copy/paste в `Linear`;
- правила синхронизации оркестратора с `Linear API`.
