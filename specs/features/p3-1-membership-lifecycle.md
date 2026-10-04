# P3.1 — выход, удаление и повторное вступление

Статус: реализована; проверки по прежним evidence. Актуализировано: 2026-10-02.
Результат: уход закрывает доступ к конкретной команде и её приватным данным,
не повреждая личное пространство или другие команды.

## Границы

Этот документ владеет membership transitions. Общий доступ к интервью —
[P1.5](p1-5-team-interview-creation.md), новые внешние назначения после ухода —
[P2.3](p2-3-room-assignments.md), owner recovery/старые suspend —
[P3.2](p3-2-suspension-owner-recovery.md), действующая ссылка вступления —
[P0.1](p0-1-team-invitations.md). Владелец команды и владелец комнаты различаются.

## Требования и переходы

| Состояние/действие | Результат | Доступ |
| --- | --- | --- |
| ACTIVE non-owner → выйти | LEFT | Команда и её private authority отозваны; PERSONAL/другие команды сохранены |
| OWNER/ADMIN удаляет ACTIVE non-owner | REMOVED | Те же границы отзыва |
| Владелец команды → выйти/быть удалённым | Отказ до отдельной передачи владения | Нельзя обойти last-owner guard |
| LEFT/REMOVED → принять действующее приглашение | ACTIVE | Общие права ACTIVE по P1.5; прежние индивидуальные назначения не восстанавливаются |
| LEFT/REMOVED → открыть публичную ссылку комнаты | Candidate | Без прежних manager/private прав |

- **R-01. Выход:** `POST /api/teams/{teamId}/leave` переводит active non-owner
  в LEFT; удаление `DELETE /api/teams/{teamId}/members/{userId}` доступно
  OWNER/ADMIN и переводит non-owner в REMOVED. В UI действия требуют подтверждения.
- **R-02. Атомарность:** изменение пишет `MEMBER_LEFT`/`MEMBER_REMOVED`, увеличивает
  epoch/security revision (версию прав) и идемпотентно возвращает прежний ответ
  по тому же `Idempotency-Key`. Ошибка допускает безопасный retry и refresh прав.
- **R-03. Изоляция отзыва:** участник исчезает из ACTIVE roster и `/api/me/workspaces`;
  team endpoints возвращают безопасный `TEAM_NOT_FOUND`/404. Старые explicit
  `room_participants`/`room_hr_assignments` этой команды очищаются. PERSONAL и
  другая команда, их интервью и назначения не меняются.
- **R-04. Подключённая комната:** после commit пересчитывается live authority;
  старые SSE/event credentials, очереди и delayed callbacks не сохраняют
  manager роль/чужие private данные. Клиент очищает защищённые панели. Публичный
  повторный вход по ссылке разрешён кандидатом по P1.5; terminal cleanup прежней
  сессии не является запретом такого нового входа.
- **R-05. Исторический создатель:** `rooms.owner_user_id` без действующего
  членства не возвращает owner authority после ухода, даже если человек создал
  интервью. Передача ownership и возврат orphan комнаты регулируются P3.2.
- **R-06. Rejoin:** действующее приглашение снова даёт ACTIVE membership и общие
  interviewer возможности во всех корректно созданных интервью команды. Старые
  индивидуальные grants не восстанавливаются; их отсутствие не блокирует общий
  доступ ACTIVE. Старая запрещающая rejoin политика отменена.
- **R-07. Новое внешнее назначение:** бывший участник может получить отдельное
  hiring назначение по P2.3, только если оно новее изменения membership; это
  не возвращает членство. Старые ссылки/credentials сами по себе командных прав
  не дают. Исторический SUSPENDED рассматривается отдельно.

## Приёмка и проверка

| ID | Требования | Сценарий → результат | Проверка |
| --- | --- | --- | --- |
| AC-01 | R-01–R-03 | MEMBER выходит/ADMIN удаляет → отсутствует roster/workspace; повтор → тот же результат; owner exit → отказ | Management/ownership PostgreSQL integration + settings E2E |
| AC-02 | R-03 | Уход из A → PERSONAL и B доступны, grants A очищены | Access integration |
| AC-03 | R-04–R-05 | Уход с открытой комнатой/старым owner token/ожидающим callback → private доступ снят, новый вход candidate возможен | Live revocation/lock-wait integration + public-access E2E |
| AC-04 | R-06 | Повторное вступление → ACTIVE shared interviewer access, без восстановления старых explicit grants | Updated creation/shared-access integration |
| AC-05 | R-07 | Старый grant → без роли; допустимое новое внешнее назначение → только назначенный доступ | Shared-access/HR removal integration |

Результаты старых lifecycle запусков — [предыдущая редакция](../references/history/p3-1-membership-lifecycle-before-2026-10-02.md);
её запреты комнаты после rejoin отменены [бизнес-правкой 28.09](../references/business-logic-verification-2026-09-28.md).
Поддержка старых suspend и отдельной передачи интервью — P3.2.
Нормализация 02.10 проверяет договор, не объявляет новый запуск приложения/тестов.
