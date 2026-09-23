### P2.3 Управление назначениями в интервью

Цель: менеджеры могут менять owner/interviewer/hiring назначения конкретной комнаты.

Готово:

- назначение нанимающего менеджера доступно из меню участника без ручного
  ввода ID и не появляется для обычных/анонимных участников;
- owner и назначенный interviewer могут добавлять hiring manager через room
  controls без расширения общих owner-only прав;
- add/remove поддерживает pending/failure/retry состояния и не создаёт дублей;
- self-removal закрывает manager panel и не даёт снять защищённого owner через
  offline manager list;
- stale/late ответы после демоушена или потери прав не восстанавливают роль и
  не переводят комнату в terminal ошибочно;
- current `410` на assignment/removal переводит комнату в terminal состояние;
- снятие hiring role синхронизируется в двух вкладках, кабинете и после
  reconnect;
- candidate admission не создаёт HR tracking, а переход обратно в interviewer
  корректно восстанавливает manager доступ;
- pending private-panel данные инвалидируются при потере доступа и не
  раскрываются после повторного открытия панели.
- проверки:
  - frontend targeted E2E assignment/removal cluster — зелёный `13/13`;
  - frontend targeted E2E owner/interviewer/candidate/private cleanup — зелёный
    `3/3`.

Что сделать:

- P2.3 MVP готов; дальнейшие доработки assignment относятся к P3 lifecycle
  сценариям ухода/удаления/повторного вступления.

Acceptance:

- поздний token не восстанавливает снятую роль;
- чужие private notes не открываются;
- изменения видны в двух вкладках и после reconnect.

