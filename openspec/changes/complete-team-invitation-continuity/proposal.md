# Proposal

## Why

Выпущенная ссылка-приглашение сейчас существует только в краткоживущем
состоянии браузера: успешное копирование или перезагрузка лишают её создателя
возможности повторно увидеть и скопировать тот же адрес. Одновременно после
принятия приглашения новый сотрудник не может увидеть фактический состав
команды: сервер не предоставляет каталог участников, а интерфейс участника
показывает заглушку «Раздел готовится».

Эти два разрыва не дают завершить приоритетный базовый совместный сценарий P0
из
`design-team-interview-journey`: выпустить безопасное приглашение, принять его
существующим аккаунтом и увидеть подтверждённое участие с обеих сторон.

## What Changes

- Добавить сохраняемое сервером, зашифрованное представление bearer-секрета
  приглашения. Создатель активного приглашения может явно снова показать ту же
  ссылку после успешного копирования или перезагрузки; браузерное постоянное
  хранение raw-секрета не добавляется.
- Сохранить базовую возможность иметь несколько независимых ожидающих
  приглашений одной команды. Новый выпуск создаёт отдельный адрес, но SHALL NOT
  изменять адрес любого уже выпущенного приглашения; только явное действие
  «Перевыпустить ссылку» для конкретного приглашения создаёт его replacement и
  инвалидирует именно прежний адрес.
- Очищать зашифрованный recoverable-секрет, когда приглашение принято,
  отозвано либо истекло; не раскрывать его другому администратору, участнику,
  неавторизованному пользователю или получателю ссылки.
- Добавить минимальный read-only каталог активных участников команды и заменить
  заглушку раздела «Участники» этим каталогом для OWNER, ADMIN и MEMBER.
  Управление приглашениями остаётся видимым и доступным только OWNER/ADMIN.
- Зафиксировать миграцию уже существующих `PENDING` приглашений без raw-секрета:
  они не перевыпускаются автоматически, но их создатель получает безопасное
  объяснение и может вручную перевыпустить ссылку.

## Capabilities

### New Capabilities

- `team-invitation-continuity`: безопасное восстановление ссылки её создателем,
  ручная ротация и очистка секрета по lifecycle.
- `team-member-directory`: минимальный каталог активных участников, доступный
  всем активным ролям без раскрытия данных интервью или логинов.

### Modified Capabilities

<!-- No accepted baseline capability exists yet for team workspaces. The related
     requirements currently live in in-progress changes and are reconciled by
     the supersession note below rather than edited here. -->
- None.

## Impact

- Backend: миграция `team_invitations`, сервис и контроллер приглашений,
  серверная криптографическая конфигурация, авторизация и новый endpoint
  каталога участников.
- Frontend: invitation API/RTK Query, видимость ссылки и ручная ротация,
  раздел «Участники» команды и его loading/error states.
- Tests: новый browser E2E с двумя аккаунтами и backend integration-проверки
  криптографического lifecycle, прямых прав и минимальности DTO.
- Security/privacy: bearer-секрет нельзя хранить в browser persistence,
  логах, трассах, user-facing audit или DTO каталога; reveal доступен только
  исходному создателю при действующем управленческом праве.

## Canonical reconciliation boundary

This change is the authoritative successor **only for the invitation-secret
lifetime contract**. It supersedes the following exact in-progress text when
the changes are reconciled:

- `design-team-interview-journey/design.md`, D4 paragraphs 141–149 that state
  the creator URL exists only in component memory, is cleared by successful
  copy/dismiss/unmount, and cannot be recovered after a lost response; and the
  invitation rows in D6 that return a raw `url` from ordinary create/reissue
  responses.
- Raw-link assertions in
  `fix-invitation-management-short-viewport` that require the issuer's raw
  link to disappear after successful copy, dismissal or remount and prohibit
  issuer-authorized recovery.

The replacement contract is per invitation: safe manager metadata survive
reload, and the current active creator may explicitly reveal its encrypted
server-held URL. Ordinary create/list/reissue DTOs stay URL-free. The new
contract does not supersede the recipient fragment/session lifecycle, one-time
acceptance, feature flags, keyboard/geometry/non-occlusion proof, responsive
layout, role denial or unavailable-team behavior.

## Supersession boundary

This change supersedes **only** the raw-link lifetime requirements named in
the Canonical reconciliation boundary above:

- an active invitation's original issuer may recover and copy the same link
  after copy, dismissal, remount or browser reload through an explicit,
  server-authorized reveal;
- successful copy no longer clears the issuer's current raw-link view; and
- the raw link may be rendered only in that issuer-only, explicitly revealed
  view while it remains `PENDING`.

It does **not** supersede the existing feature-flag, role-denial, one-time
acceptance, expiry/revoke, responsive keyboard-reachability, team-unavailable,
or browser-persistence protections. In particular, `localStorage`,
`sessionStorage`, browser history, URL routing, logs and telemetry still must
not persist or expose the bearer secret. The older short-viewport change is not
edited by this proposal; its outstanding evidence and tests must be reconciled
only at the named secret-lifetime assertions before either change is accepted.
