### P3.3 Завершение интервью и результат

Цель: завершённое интервью остаётся в истории с результатом и безопасными правами.

Готово:

- `POST /api/rooms/{inviteCode}/verdict` для назначенного interviewer уже
  завершает TEAM-комнату: сохраняет `status=finished`, `verdict`,
  `verdictComment` и первый `finishedAt`;
- список командных интервью возвращает result-проекцию завершённой комнаты:
  `finishedAt`, `verdict`, `verdictComment` и `taskScores`;
- карточка командного интервью показывает завершённый статус, время завершения,
  вердикт, комментарий и оценки задач;
- отсутствующая оценка задачи отображается как «без оценки», а не как `0`;
- после `finished`/`frozen` TEAM-комната отклоняет late live-команды
  `notes_update`, `task_rating_update` и `set_step` с конфликтом, не меняя
  сохранённый результат;
- после `finished`/`frozen` TEAM-комната отклоняет late editor/live-write
  события `code_update`, `language_update`, `briefing_markdown_update` и
  `yjs_update` с конфликтом до изменения in-memory/DB snapshot; отложенное
  сохранение editor/Yjs snapshot также повторно проверяет статус комнаты;
- после `finished`/`frozen` live-записи чата и личных заметок отклоняются с
  конфликтом до изменения `interviewer_chat`/`private_notes_json`;
- после `finished`/`frozen` realtime и REST manager workspace saves
  отклоняются с конфликтом до изменения скрытых `room_tasks` snapshots;
- после `finished`/`frozen` REST и realtime grant/revoke для personal-room
  отклоняются с конфликтом до изменения `room_participants` или runtime
  guest-grant; архивная комната остаётся терминальной через `410 Gone`;
- завершённое TEAM-интервью остаётся в общей истории с result-проекцией даже
  после потери владельца, но не попадает в orphaned owner queue и отклоняет
  owner-offer/archive/freeze/resume lifecycle-команды с
  `TEAM_INTERVIEW_FINISHED`;
- проверка:
  - backend `TeamInterviewCreationIntegrationTest` — зелёный `21/21`;
  - backend `HrRoleRemovalIntegrationTest` — зелёный `21/21`;
  - backend `RealtimeChatIdempotencyIntegrationTest` — зелёный `30/30`;
  - frontend `npm run typecheck` — зелёный.

Что сделать:

- функциональный scope P3.3 закрыт; дальше двигаться к следующему пункту
  плана.

Acceptance:

- архивное интервью нельзя снова запустить;
- результат доступен назначенным действующим сотрудникам;
- отсутствие оценки не показывается как ноль.
