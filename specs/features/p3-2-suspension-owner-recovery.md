# P3.2 — восстановление владельца и старых приостановок

Статус: реализована в текущих границах. Актуализировано: 2026-10-02.
Результат: команда безопасно восстанавливает владельца orphan-интервью;
старые SUSPENDED memberships поддерживаются без новых действий приостановки в UI.

## Границы и связи

Новые приостановки сняты с пользовательского продукта. Старые переходные
suspend/resume данные/API не становятся новым обычным способом управления:
основной путь — удаление по [P3.1](p3-1-membership-lifecycle.md).
Общий доступ ACTIVE/candidate — [P1.5](p1-5-team-interview-creation.md), внешние
назначения — [P2.3](p2-3-room-assignments.md), права finished/frozen/archived —
[P3.3](p3-3-interview-result.md). Общие interviewer права не расширяют отдельные
OWNER/ADMIN orphan lifecycle операции.

## Прежние приостановки

- **R-01. Legacy membership:** сохранённый suspend переводит active non-owner в
  SUSPENDED; resume возвращает в ACTIVE. Только OWNER/ADMIN выполняет эти
  переходные операции. Переходы имеют `Idempotency-Key`, audit
  `MEMBER_SUSPENDED`/`MEMBER_RESUMED`, epoch/security revision. Suspend очищает
  explicit participant/HR grants и после commit пересчитывает live права только
  своей команды. Командный owner не снимается этим способом.
- **R-02. Видимость:** SUSPENDED отсутствует в обычном ACTIVE roster/workspaces;
  protected team endpoints безопасно отказывают. `members?state=SUSPENDED` —
  отдельный OWNER/ADMIN список; обычный участник получает 403
  `TEAM_MEMBER_LIST_FORBIDDEN`, suspended — 404 `TEAM_NOT_FOUND`. Публичный
  candidate admission комнаты сохраняется по P1.5; новое external hiring
  назначение SUSPENDED запрещено по P2.3.
- **R-03. Resume:** старые explicit room grants не восстанавливаются. ACTIVE
  возвращает общие TEAM interviewer права по P1.5; прежнее правило ожидания
  нового индивидуального назначения отменено.

## Интервью без владельца

Orphaned — активное TEAM-интервью, текущий owner которого больше не является
активным участником команды. Передача комнаты не передаёт владение командой.

- **R-04. Очередь:** `interviews?ownership=orphaned` и UI очередь доступны OWNER/ADMIN;
  обычный участник получает `TEAM_INTERVIEW_QUEUE_FORBIDDEN`/403. Проекция
  сохраняет `ownerUserId`, `ownerDisplayName`, причины `ACTIVE`, `OWNER_SUSPENDED`,
  `OWNER_LEFT`, `OWNER_REMOVED`, `OWNER_MISSING` и lifecycle status.
- **R-05. Предложение:** OWNER/ADMIN создаёт owner-offer для активного преемника
  только orphaned-комнаты. Pending inbox показывает человеку только его offers.
  Accept/decline доступны только target; accept меняет owner и room-role owner,
  decline не меняет владение. Истёкший `expiresAt` не принимается, не показывается
  в pending inbox и переводит PENDING → EXPIRED при чтении.
- **R-06. Архив:** OWNER/ADMIN может архивировать orphaned-интервью без преемника;
  pending offers становятся CANCELLED, realtime закрывается после commit.
  Finished исключён из этого lifecycle по P3.3.
- **R-07. Заморозка/возобновление:** OWNER/ADMIN freeze orphaned-интервью с audit
  `TEAM_INTERVIEW_FROZEN`; live после commit инвалидируется. Resume допускает
  OWNER/ADMIN либо текущего нового owner, возвращает active с audit
  `TEAM_INTERVIEW_RESUMED`. Accept ownership не выполняет resume автоматически.
  Frozen допускает публичный просмотр candidate, но блокирует editor/live/task/
  workspace записи всем по P3.3; старое скрытие кандидата отменено.
- **R-08. Resume и кэш:** commit resume инвалидирует прежний cached SSE state/
  eventToken. Тот же browser session после reconnect получает новый token и
  active состояние; EditorView не пересоздаётся. Finished нельзя resume.

## Контракты и интерфейс

Owner-offers, accept/decline, archive, freeze/resume используют существующие
`/api/teams/{teamId}/interviews/{interviewId}/...` endpoints; pending inbox —
`/api/teams/{teamId}/interview-owner-offers?status=pending`.
UI показывает причины orphan, предложение активному участнику, его accept/
decline и отдельное действие возобновления новым владельцем. Архив удаляет
предложение из inbox. Legacy suspended recovery остаётся внутренним переходным
сценарием; кнопка новой приостановки не возвращается.

## Приёмка и проверка

| ID | Требования | Сценарий → результат | Проверка |
| --- | --- | --- | --- |
| AC-01 | R-01–R-03 | Старый suspend/resume → отзыв старых grants и возврат ACTIVE shared access; manager-only список без утечки | Membership integration |
| AC-02 | R-04–R-05 | OWNER/ADMIN предлагает → только target принимает/отклоняет; stale/expired → отказ без передачи | Owner-offer PostgreSQL integration + existing UI flow |
| AC-03 | R-06 | Архив orphaned → CANCELLED offers, closed realtime, недоступная публичная запись | Lifecycle integration |
| AC-04 | R-07–R-08 | Accept frozen → остаётся frozen; разрешённый resume → active/new event token без нового EditorView | Lifecycle integration + hydration E2E |
| AC-05 | R-04–R-08 | MEMBER/чужой target/finished lifecycle → безопасный отказ; public frozen candidate → просмотр без live записи | Permission/status integration |

Прежние результаты — [историческая редакция](../references/history/p3-2-suspension-owner-recovery-before-2026-10-02.md),
[UI-проверки resume](../references/ui-2-verification-2026-09-27.md),
[актуальные shared права 28.09](../references/business-logic-verification-2026-09-28.md).
Нормализация 02.10 не объявляет свежий PASS или включение feature flags.
