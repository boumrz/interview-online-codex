### P2.2 Чат и активность

Цель: внутренний чат и активность не теряют сообщения, draft и position при reconnect/смене панели.

Готово:

- pending/retryable/persisted состояния сообщения;
- stable client message id;
- dedupe ACK/SSE echo;
- unread badge;
- visible-only catch-up;
- terminal cleanup при revoke/смене комнаты/account;
- activity history без скачков scroll.
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
