# Историческая редакция до нормализации 2026-10-02

Это сохранённый прежний текст и результаты прежних запусков. Он не задаёт
действующие требования и не подтверждает новый PASS. Актуальный договор:
[p3-2-suspension-owner-recovery.md](../../features/p3-2-suspension-owner-recovery.md).

---

### P3.2 Срочное приостановление и восстановление владельца

Цель: админ может срочно приостановить участие и безопасно передать зависшие комнаты.

Готово:

- backend `POST /api/teams/{teamId}/members/{userId}/suspend` доступен
  OWNER/ADMIN, переводит активного non-owner участника в `SUSPENDED`, пишет
  audit `MEMBER_SUSPENDED`, двигает epoch/security revision и идемпотентно
  восстанавливает ответ по тому же `Idempotency-Key`;
- suspend очищает старые team room grants пользователя (`room_participants`,
  `room_hr_assignments`) только внутри команды и после commit синхронизирует
  live realtime-доступ;
- suspended участник теряет команду в `/api/me/workspaces`, не может читать
  roster и получает безопасный `404` для старой TEAM-room и realtime
  stream-status;
- backend `POST /api/teams/{teamId}/members/{userId}/resume` возвращает
  `SUSPENDED` non-owner участника в `ACTIVE`, пишет audit `MEMBER_RESUMED`,
  двигает epoch/security revision и не восстанавливает старые room grants;
- resumed участник снова видит командное пространство и roster, но старые
  назначения на TEAM-room остаются недоступными до явного нового назначения;
- backend `GET /api/teams/{teamId}/members?state=SUSPENDED` возвращает
  отдельный безопасный manager-only список приостановленных участников:
  default roster остаётся только `ACTIVE`, non-manager получает `403
  TEAM_MEMBER_LIST_FORBIDDEN`, сам suspended-участник получает безопасный
  `404 TEAM_NOT_FOUND`;
- UI настроек команды получил действие «Приостановить участника» с явным
  подтверждением, выбором активного non-owner участника, retry/idempotency-path
  и refresh прав;
- UI настроек команды показывает блок «Приостановленные участники» и кнопку
  «Восстановить участника»: восстановление дергает resume API, обновляет
  active/suspended roster и не восстанавливает старые назначения в интервью;
- backend `GET /api/teams/{teamId}/interviews?ownership=orphaned` даёт
  manager-only очередь активных TEAM-интервью, где `rooms.owner_user_id` больше
  не является активным участником этой команды; обычный участник получает
  `403 TEAM_INTERVIEW_QUEUE_FORBIDDEN`;
- элементы списка интервью включают безопасные поля владельца:
  `ownerUserId`, `ownerDisplayName`, `ownershipState`
  (`ACTIVE`, `OWNER_SUSPENDED`, `OWNER_LEFT`, `OWNER_REMOVED`,
  `OWNER_MISSING`) и lifecycle `status` (`active`, `frozen`, `finished`);
- UI вкладки «Интервью» для OWNER/ADMIN показывает блок «Интервью без
  владельца» с причиной orphan-состояния и исходным владельцем; обычные
  участники этот endpoint не запрашивают;
- backend offer lifecycle получил MVP:
  - `POST /api/teams/{teamId}/interviews/{interviewId}/owner-offers` создаёт
    manager-only предложение новому активному участнику, только если интервью
    находится в orphaned-состоянии;
  - `GET /api/teams/{teamId}/interview-owner-offers?status=pending` показывает
    целевому активному участнику только его pending offers;
  - `POST /api/teams/{teamId}/interviews/{interviewId}/owner-offers/{offerId}/accept`
    доступен только target-участнику, переводит offer в `ACCEPTED`, меняет
    `rooms.owner_user_id` на нового активного владельца и явно выдаёт ему
    room-role `owner` без автоматического resume frozen-комнаты;
  - `POST /api/teams/{teamId}/interviews/{interviewId}/owner-offers/{offerId}/decline`
    доступен только target-участнику, переводит offer в `DECLINED`, убирает
    его из pending inbox и не меняет владельца интервью;
  - `POST /api/teams/{teamId}/interviews/{interviewId}/archive` доступен
    OWNER/ADMIN только для orphaned-интервью, архивирует комнату без
    преемника, закрывает realtime после commit и переводит pending owner
    offers по комнате в `CANCELLED`;
  - offers имеют `expiresAt`, expired offer не принимается, не возвращается в
    pending inbox и при чтении inbox переводится из `PENDING` в `EXPIRED`;
- backend freeze/resume lifecycle:
  - `POST /api/teams/{teamId}/interviews/{interviewId}/freeze` доступен
    OWNER/ADMIN только для orphaned-интервью, переводит комнату в `frozen`,
    пишет audit `TEAM_INTERVIEW_FROZEN` и закрывает live realtime после commit;
  - frozen TEAM-room скрывает обычного кандидата безопасным `404` для REST и
    realtime stream-status, но остаётся доступной управляющим ролям;
  - `POST /api/teams/{teamId}/interviews/{interviewId}/resume` доступен
    OWNER/ADMIN или текущему новому `owner_user_id`, переводит frozen-комнату
    обратно в `active` и пишет audit `TEAM_INTERVIEW_RESUMED`;
- UI вкладки «Интервью» позволяет OWNER/ADMIN выбрать активного участника в
  блоке «Интервью без владельца» и отправить предложение; target-участник видит
  блок «Предложения владения интервью» и принимает либо отклоняет владение из
  интерфейса;
- UI очереди «Интервью без владельца» позволяет OWNER/ADMIN архивировать
  orphaned-интервью без преемника; pending offer у target после архивации
  исчезает;
- UI очереди «Интервью без владельца» позволяет OWNER/ADMIN заморозить
  orphaned-интервью для кандидата, показывает бейдж «Заморожено для
  кандидата», а новый owner после accept видит карточку frozen-интервью и сам
  нажимает «Возобновить интервью»;
- проверки:
  - backend focused RED→GREEN suspend scenario — зелёный;
  - backend focused RED→GREEN resume scenario — зелёный;
  - backend focused RED→GREEN suspended directory scenario — зелёный;
  - backend focused RED→GREEN orphaned interview queue scenario — зелёный;
  - backend `TeamMemberDirectoryIntegrationTest` — зелёный `8/8`;
  - backend management/interview lifecycle suite — зелёный `41/41`;
  - backend focused owner offer accept/decline/expire-cleanup scenarios —
    зелёный `3/3`;
  - backend focused orphaned interview blind archive scenario — зелёный `1/1`;
  - backend focused orphaned interview freeze/resume scenario — зелёный `1/1`;
  - backend `TeamInterviewCreationIntegrationTest` — зелёный `20/20`;
  - frontend `npm run typecheck` — зелёный;
  - frontend isolated E2E P3 suspend settings — зелёный `1/1`;
  - frontend isolated E2E P3 resume settings — зелёный `1/1`;
  - frontend isolated E2E P3.2 orphaned queue + owner offer accept — зелёный `1/1`;
  - frontend isolated E2E P3.2 owner offer decline — зелёный `1/1`;
  - frontend isolated E2E P3.2 orphaned interview blind archive — зелёный
    `1/1`;
  - frontend isolated E2E P3.2 orphaned interview freeze/resume — зелёный
    `1/1`;
  - frontend isolated E2E P3 lifecycle settings — зелёный `1/1`;
  - frontend combined E2E P3 retry: новые suspend/resume сценарии зелёные,
    старый lifecycle сценарий один раз дал известный timeout ожидания статуса
    и затем прошёл отдельно.

Что сделать:

- функциональный scope P3.2 по orphaned/freeze/resume закрыт; дальше двигаться
  к P3.3 и расширенным состояниям завершения/результата;

Исторический acceptance приостановки (неактивен для новых действий):

- suspend срабатывает даже при активных Yjs/POST/export;
- нет deadlock;
- candidate не получает frozen room;
- новый owner сам принимает и отдельно возобновляет интервью.

## Корректировка по продуктовой проверке 2026-09-23

- Новые приостановки участников больше не предлагаются в интерфейсе. Восстановление старых приостановленных учётных записей остаётся внутренним переходным сценарием; обычное управление доступом использует удаление участника.

## Регрессия старой frozen-комнаты — 2026-09-27

Resume после commit инвалидирует прежнее cached realtime/SSE состояние, чтобы уже подключённый управляющий получил active и снова мог редактировать. Проверки прав, запрет resume завершённой комнаты и скрытие frozen-комнаты от кандидата сохраняются. Интеграционный тест повторно подключает тот же sessionId с новым event token и подтверждает смену языка/сохранение. Frontend hydration test сохраняет тот же EditorView при frozen→active. [Полное evidence UI.2](../ui-2-verification-2026-09-27.md).
