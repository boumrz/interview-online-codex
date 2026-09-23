# Proposal

## Why

После нескольких последовательных browser-room сценариев полный AC-11 E2E
останавливается: новые комнаты больше не инициализируются, а backend сообщает,
что все десять соединений Hikari заняты. Это не позволяет доказать стабильность
обычного realtime-пути и блокирует release-проверку уже реализованных UX-правок.

## What Changes

- Воспроизводимо диагностировать lifecycle SSE-подключения, browser-context и
  database-работы при последовательном открытии и закрытии комнат.
- Устранить подтверждённую причину накопления ресурсов минимальным изменением,
  не маскируя утечку простым увеличением пула.
- Доказать, что закрытая комната освобождает realtime-ресурсы, а полный
  `e2e-room-context-panels` завершается 18/18 на свежем feature-on runtime.
- Сохранить действующие authorization, reconnect, SSE POST relay и Yjs
  семантики, добавив coverage для normal-close, reconnect и нескольких
  участников.

## Capabilities

### New Capabilities

- `room-realtime-resource-lifecycle`: безопасное создание, закрытие и
  освобождение ресурсов realtime-комнаты при последовательных SSE-сессиях.

### Modified Capabilities

- None.

## Impact

- Backend realtime lifecycle: `RealtimeController`, `CollaborationService` и
  только подтверждённые зависимости соединения/транзакции; frontend может быть
  затронут исключительно для корректного normal-close, если диагностика докажет
  его необходимость.
- E2E room fixtures и/или focused backend integration tests; без изменения API,
  схемы базы, feature-flag default, авторизации или Yjs wire-format.
- Любое изменение SSE, транзакций, connection-pool или reconnect-поведения
  проходит security/reliability review. Увеличение размера Hikari-пула само по
  себе не является допустимым исправлением.
