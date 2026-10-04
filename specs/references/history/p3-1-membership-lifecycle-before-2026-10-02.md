# Историческая редакция до нормализации 2026-10-02

Это сохранённый прежний текст и результаты прежних запусков. Он не задаёт
действующие требования и не подтверждает новый PASS. Актуальный договор:
[p3-1-membership-lifecycle.md](../../features/p3-1-membership-lifecycle.md).

---

### P3.1 Выход, удаление, повторное вступление

Цель: уход сотрудника закрывает только его командный доступ и не ломает личное пространство.

Готово:

- backend `POST /api/teams/{teamId}/leave` переводит активного non-owner
  участника в `LEFT`, пишет audit `MEMBER_LEFT`, двигает epoch/security revision
  и идемпотентно восстанавливает ответ по тому же `Idempotency-Key`;
- backend `DELETE /api/teams/{teamId}/members/{userId}` доступен OWNER/ADMIN,
  переводит выбранного non-owner участника в `REMOVED`, пишет audit
  `MEMBER_REMOVED`, двигает epoch/security revision и идемпотентно
  восстанавливает ответ;
- last owner guard включён: owner не может выйти или быть удалён без отдельной
  передачи владения;
- после `LEFT`/`REMOVED` участник исчезает из roster, теряет команду в
  `/api/me/workspaces`, получает безопасный `TEAM_NOT_FOUND`/`404` для roster и
  не возвращается старыми credentials;
- `LEFT`/`REMOVED` теперь очищает старые team room grants пользователя
  (`room_participants`, `room_hr_assignments`) только внутри этой команды, не
  затрагивая личные интервью и другие команды;
- повторное вступление через новое приглашение не восстанавливает старый доступ
  к team room и realtime stream-status;
- browser-flow после rejoin подтверждает ту же семантику: старая карточка
  интервью остаётся обзорной, но больше не показывает CTA «Открыть комнату», а
  прямой переход в `/room/{inviteCode}` показывает недоступную комнату без
  editor host;
- active browser room cleanup подтверждён через новый lifecycle endpoint:
  открытая TEAM-room вкладка удалённого участника переходит в terminal
  «Комната недоступна», editor host и manager surfaces исчезают;
- non-owner creator, который числится в `rooms.owner_user_id`, после выхода из
  команды теряет доступ к созданной TEAM-room: `owner_user_id` остаётся
  исторической меткой, явные room grants очищаются, REST/realtime возвращают
  безопасный `404`;
- live TEAM-room права синхронизируются после commit через existing
  collaboration permission sync;
- UI настроек команды получил явные действия «Удалить участника» и «Выйти из
  команды» с подтверждением, retry/idempotency-path и безопасным refresh прав;
- проверки:
  - backend `TeamInterviewCreationIntegrationTest` — зелёный `13/13`, включая
    RED→GREEN сценарий: removed assignee rejoin не восстанавливает старую
    комнату/realtime admission, а historical `owner_user_id` не даёт доступ
    после выхода creator из команды;
  - backend `TeamMemberDirectoryIntegrationTest` — зелёный `8/8` (общий
    directory suite; P3.1 сценарии остаются покрыты);
  - backend `TeamManagementCommandIntegrationTest` +
    `TeamOwnershipTransferIntegrationTest` — зелёный `19/19`;
  - frontend isolated E2E настроек команды — зелёный `12/12`, включая сценарий
    owner удаляет участника, admin выходит, оба теряют roster-доступ.
  - frontend isolated E2E team-workspaces P3.1 — зелёный `2/2`:
    rejoined member не получает обратно старое назначение/room CTA; active
    room удалённого участника закрывает защищённый browser context.

Что сделать:

- reactivate/resume flow для вручную приостановленных/возвращаемых участников
  закрыт в P3.2;
- полноценный transfer/resume сценарий для владельца команды остаётся в P3.2:
  сейчас owner exit безопасно блокируется last-owner guard, а room-level
  `owner_user_id` у TEAM-room не является источником доступа;

Acceptance:

- личное пространство и другая команда остаются доступны;
- старые ссылки не возвращают доступ в команду;
- повторное вступление не восстанавливает прежние назначения автоматически.
