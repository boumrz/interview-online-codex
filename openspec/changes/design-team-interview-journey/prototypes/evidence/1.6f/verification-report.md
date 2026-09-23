# 1.6f — UX-13 / DA-06 verification

Дата: 2026-09-09. Точка входа: [`../../merge.html`](../../merge.html). Артефакт явно помечен как prototype-only: он не доказывает серверную авторизацию, две серверные подписи, атомарность/persistence commit или production redirect guard.

## Результат

- Automated report: **PASS** (`report.json`).
- Geometry: **44/44** комбинаций — 11 viewports × zoom 100/125/150/200%, без document horizontal overflow; все видимые targets названы и не меньше 44×44 CSS px.
- Состояния: loading, empty, error, conflict/stale, revoked и success имеют разные сигналы; pending commit и confirmed result разведены.
- Роли: source OWNER, destination OWNER, same OWNER и non-owner/revoked проверены отдельно.
- Transaction semantics: две approval seals одной revision, revision reset, отдельный feature flag, отдельный destination-owner commit, neutral blockers, отсутствие partial success и один confirmed receipt проверены.
- Privacy: до review скрыто имя назначения; non-owner и unauthorized old route не получают plan revision или target identity; review/blocker copy не раскрывает candidate/room details.
- Keyboard/focus: **14/14** последовательных Tab targets имеют accessible name и видимый outline.
- Compact viewport: при `visualViewport` 390×360 primary commit после обычного scroll целиком виден; safe-area variable объявлена.
- Runtime: **0** page/console errors.

## Evidence

- `report.json` — итог и contract assertions.
- `bounding-rectangles.json` — 44 geometry records и representative screen measurements.
- `focus-trace.json` — keyboard focus trace.
- `visual-viewport-keyboard.json` — compact/keyboard-height simulation.
- `screenshots/` — 14 representative captures: exact target, request/inbox, collisions, review, stale/blockers/failure, revoked, commit/result и оба redirect outcomes.

## Ограничение

Chromium headless, CSS zoom и уменьшенный viewport не равны физическому телефону и реальной экранной клавиатуре. Manual supported mobile/browser verification остаётся gate 1.6g. Production permissions, dual approvals, atomic commit, persistence drain и redirect authorization должны подтверждаться последующими executable tests, а не этим HTML.
