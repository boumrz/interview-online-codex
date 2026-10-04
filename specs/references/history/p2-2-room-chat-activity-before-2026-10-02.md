# Историческая редакция до нормализации 2026-10-02

Это сохранённый прежний текст и результаты прежних запусков. Он не задаёт
действующие требования и не подтверждает новый PASS. Актуальный договор:
[p2-2-room-chat-activity.md](../../features/p2-2-room-chat-activity.md).

---

### P2.2 Чат и активность

Цель: внутренний чат и активность не теряют сообщения, draft и position при reconnect/смене панели.

Готово:

- pending/retryable/persisted состояния сообщения;
- stable client message id;
- dedupe ACK/SSE echo;
- unread badge;
- visible-only catch-up;
- terminal cleanup при revoke/смене комнаты/account;
- внутренние сообщения работают в TEAM-комнатах через действующий event token;
  сервер сохраняет сообщения только от текущих owner/interviewer назначений,
  а кандидат и отозванный участник не получают доступ к чату;
- team-room `note_message` больше не маскируется под `404 ROOM_NOT_FOUND`;
  доступ проверяется по текущему назначению на сервере: interviewer получает
  ACK `200`, кандидат — `403 ROOM_ACCESS_DENIED`, повтор idempotency key не
  создаёт второе сообщение;
- textarea чата начинается с четырёх строк и растёт до десяти строк;
- activity history без скачков scroll.
- Browser E2E подтверждает отправку из комнаты после создания: `POST
  /api/realtime/rooms/{inviteCode}/events` возвращает `200`; поле ввода чата не
  ниже 100 px при начальной высоте.
- unit `roomChatDelivery.test.ts` — зелёный `7/7`;
- frontend `npm run typecheck` — зелёный;
- E2E `e2e-room-panel-continuity.mjs` — зелёный `4/4`:
  - draft/panel/read position сохраняются при step changes и reconnect;
  - новое сообщение не крадёт focus/scroll и даёт unread;
  - activity history опрашивается только когда видима и делает один catch-up;
  - потерянный ACK даёт ручной retry с тем же immutable intent;
  - room/account change и terminal revoke очищают protected chat state, late ACK
    не восстанавливает сообщение.

Что сделать:

- P2.2 MVP готов; дальнейшие доработки здесь считаются polish после следующих
  пакетов комнаты.

Acceptance:

- потерянный ACK не создаёт дубль;
- reconnect восстанавливает состояние;
- новое сообщение не перехватывает focus;
- draft сохраняется при переключении панели и шага;
- terminal revoke очищает защищённое состояние.
