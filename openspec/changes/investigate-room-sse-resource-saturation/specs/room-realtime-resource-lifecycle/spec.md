# Spec Delta

## Purpose

Гарантировать, что последовательные realtime-сессии комнат освобождают временные
SSE и database-ресурсы и не блокируют открытие следующих интервью.

## ADDED Requirements

### Requirement: Closed room streams release resources before later room admission

Когда участник закрывает браузерный контекст, уходит с route комнаты или заменяет
своё SSE-подключение новым, система SHALL завершать прежнюю realtime-сессию и
освобождать связанные с ней временные серверные ресурсы. Последовательное
открытие и закрытие комнат SHALL NOT оставлять занятые ресурсы, которые не дают
авторизованному участнику открыть последующую комнату. Нормальное закрытие
клиента SHALL NOT менять историю комнаты, published step, код, приватные заметки
или роль другого участника.

Закрытый connection SHALL переставать быть допустимым источником POST relay
событий; активная replacement-сессия SHALL сохранять обычную authorization и
reconnect-семантику. Система SHALL NOT решать проблему только увеличением
connection-pool, ослаблением authorization или отключением SSE.

Pre-implementation acceptance-test level: **E2E** в
`frontend/tests/e2e/interview/e2e-room-context-panels.mjs`, поскольку реальное
закрытие browser context, следующий room route и SSE lifecycle наблюдаемы только
через полный стек. Focused backend integration test SHALL дополнять E2E для
детерминированной проверки того, что серверный connection registry очищается
после normal close/replacement; он является пропорциональным исключением для
внутренней resource-accounting арифметики.

Диагностическая проверка SHALL быть встроена в существующий top-level scenario
`owner and assigned interviewer select locally and publish only through the
explicit action`; она SHALL NOT добавлять отдельный top-level test. Полный
контракт сохраняет ровно 18 top-level tests и требует TAP summary `pass 18`,
`fail 0`, `skipped 0` в одном свежем процессе.

#### Scenario: Последовательные комнаты продолжают открываться после закрытия предыдущих
- **WHEN** fresh feature-on runtime последовательно выполняет полный набор
  room-context E2E, создавая и закрывая browser contexts и SSE-сессии
- **THEN** каждый последующий авторизованный участник получает editor и active
  realtime connection без timeout из-за исчерпания server/database ресурсов
- **AND** полный `e2e-room-context-panels` завершается успешно без скрытия или
  пропуска поздних сценариев

#### Scenario: Закрытая SSE-сессия не сохраняет event authority
- **WHEN** клиентская room-сессия штатно закрыта либо заменена reconnect-сессией
- **THEN** прежний event token и connection больше не принимают room relay
  события
- **AND** действующая сессия того же авторизованного участника продолжает
  синхронизироваться по существующему SSE/Yjs контракту

### Requirement: Realtime lifecycle regression is diagnosed without exposing operational internals

Тестовый контур SHALL позволять отличить product regression от накопления
SSE/browser/database ресурсов: при failure он фиксирует порядок закрытия
контекстов, возможность следующей room admission и подтверждённый server-side
cleanup state. Такая диагностика SHALL быть test-scoped или internal и SHALL NOT
создавать публичный endpoint, раскрывающий connection pool, participant IDs,
event tokens или room presence неавторизованным пользователям.

Диагностика SHALL проверять normal close, replacement/reconnect и несколько
последовательных участников, room-route unmount, transport timeout/error и
устаревший event-token POST relay; она SHALL NOT заменять полный E2E отбором
только изолированных сценариев. Повторный full-suite failure SHALL сообщать
точную неосвобождённую resource category, а не маскироваться retry, увеличением
timeout или пропуском сценария.

Для live E2E backend SHALL при явно включённом test-only diagnostic mode писать
в предоставленный локальный log только monotonic sequence, reason и агрегированные
числа server registry и Hikari active/idle. Этот режим SHALL быть default-off,
SHALL NOT менять transport-поведение и SHALL NOT создавать HTTP route, response,
metric endpoint или запись с идентификатором комнаты, участника, connection либо
event token.

#### Scenario: Полный E2E сообщает lifecycle причину, а не неясный editor timeout
- **WHEN** resource cleanup нарушен во время последовательного room E2E
- **THEN** test evidence однозначно сообщает, осталась ли открытая SSE/session
  registration или database resource
- **AND** failure не меняет production API-response, authorization или данные
  комнат только ради диагностики
