# Proposal

## Why

После принятого P0-среза приглашений и каталога участников команда видит свой
состав, но не может безопасно управлять названием, управленческими ролями и
владением. Нужен следующий P1-срез, в котором такие действия остаются
проверяемыми на сервере, объяснимыми в интерфейсе и наблюдаемыми через
минимальный приватный аудит.

## What Changes

- Формализовать публичный словарь безопасных кодов действий аудита команды и
  добавить manager-only постраничный журнал без секретов, данных интервью и
  приватных полей аккаунта.
- Разрешить ACTIVE OWNER и ADMIN переименовывать команду с CAS и
  идемпотентным восстановлением результата.
- Разрешить только ACTIVE OWNER менять **stored** роль другого ACTIVE,
  не-владельца между `ADMIN` и `MEMBER`.
- Разрешить только текущему ACTIVE OWNER атомарно передавать владение другому
  ACTIVE участнику. После передачи новый и прежний владелец имеют stored
  `ADMIN`; effective OWNER существует ровно один.
- Добавить доступный role-aware экран настроек и аудита: MEMBER не получает
  controls или API аудита; ADMIN получает переименование и журнал; OWNER
  получает также изменение роли и передачу владения.
- Ввести RED-first backend integration и browser E2E доказательства для
  прав, CAS, lost response/replay, гонок, cache/privacy и доступности.

## Capabilities

### New Capabilities

- `team-management-settings-audit`: безопасное управление названием, ролями и
  team ownership, а также приватный журнал действий управляющих.

### Modified Capabilities

None. `team-workspaces` ещё находится в незавершённом change
`design-team-interview-journey` и не является accepted spec; этот P1-срез
публикует самостоятельный delta-contract, используя его и завершённый
`complete-team-invitation-continuity` только как baseline.

## Impact

- Backend: защищённые team-management endpoints, current-owner authority,
  existing `Team`, `TeamMembership`, `CommandReceipt` и `TeamAuditEvent`
  транзакции, pagination/query и DTO allowlist. Новая внешняя зависимость не
  требуется; необходимость additive migration определяется только после
  проверки существующей V11 audit schema.
- Frontend: scoped RTK Query contracts и role-aware «Настройки команды» /
  «Аудит» surface, включая error/retry/focus states.
- Security/reliability: server-side authorization, CAS, 24-hour
  idempotency-receipts, lock ordering, no-store responses и prevention of
  audit disclosure become release gates.
- Explicit boundary: change does not create, revoke or alter room ownership,
  interview access, grants, membership state or epoch; it does not add
  suspension/removal/rejoin, room-owner transfer, SSE/polling, feature-flag
  rollout, audit export, retention policy or a global audit search.
