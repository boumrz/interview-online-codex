# Improvements 2026-05-15 — Briefing UX, Plain text language, PDF export

Артефакт оформлен в формате Task/Review envelope из
[`MULTI_AGENT_SYSTEM.md`](../MULTI_AGENT_SYSTEM.md), чтобы привязать
четыре исправления к ролевой модели проекта (PO → Architect → TL →
Developer → Reviewers → QA). Один документ покрывает все четыре
issue, потому что они затрагивают общую секцию `room`+`account`.

---

## 1. Specification (TZ) Agent

Исходные требования (от Product Owner / пользователя):

1. Markdown-панель брифинга должна:
   - уметь разворачиваться на весь экран (локально, у одного участника);
   - уметь полностью **заменять** блок с кодом у обоих участников
     по команде интервьюера.
2. В списке языков комнаты/задач должен быть `plain text`, чтобы
   обсуждать задачи без привязки к синтаксису.
3. При создании задачи диалог должен пред-заполнять язык значением
   активного таба (был баг: всегда подставлялся `nodejs`).
4. Выгрузка PDF приватных заметок не должна фризить интерфейс при
   большом числе записей.

Acceptance criteria: см. envelopes ниже.

## 2. Architect Agent — принятые решения

| Решение | Альтернатива | Почему так |
| --- | --- | --- |
| Synced focus-mode хранится **в `briefingMarkdown`** через скрытый sentinel `<!--briefing:focus=on-->\n` | Новое поле в `RealtimeState` + WS-протокол + БД-миграция | Минимизируем blast radius: 0 backend-миграций, прежние клиенты ничего не ломают, флоу уже синхронизируется через `briefing_markdown_update`. |
| Локальный fullscreen — local-only state в `BriefingBoard` | Тоже синхронизировать | Раскрытие на весь экран — личная читалка; синхронизация мешала бы кандидату закрыть оверлей. |
| `plaintext` сворачивается на бэке в отдельный канонический ключ | Принимать как-есть и считать невалидным | `LanguageNormalizer` уже сворачивает unknown → `nodejs`. Без явной ветки plain text молча превращался бы в Node JS. |
| Создание задачи: проставляем язык в `onClick` кнопки открытия модалки | `useEffect(modalOpened)` | Сохраняем «open intent» в одном месте; не появляется лишний эффект-ребайнд. |
| PDF: переписан на нативный `pdf.text()` + `await nextFrame()` между порциями | `Web Worker` | `jspdf` нативно работает в main thread, перенос его в worker — отдельная инфраструктура; нативный текст-рендер ~10x быстрее канвас-png-пути и сам по себе снимает фриз. |

## 3. Team Lead Agent — декомпозиция

```yaml
id: TASK-BRIEFING-FOCUS
title: Synced focus-mode + local fullscreen for briefing markdown
owner_agent: Frontend Developer
files:
  - frontend/src/features/room/briefingFocusMode.ts (new)
  - frontend/src/features/room/BriefingBoard.tsx
  - frontend/src/pages/RoomPage.tsx
  - frontend/src/pages/RoomPage.module.css
acceptance_criteria:
  - Owner toggle переключает блок code↔markdown у обоих участников.
  - Кандидат не может включить focus-mode (нет кнопки).
  - Local fullscreen у одного участника не влияет на других.
  - ESC выходит из fullscreen.
reviewer_agents: [Solution Reviewer, UX Critic, Test Reviewer]
```

```yaml
id: TASK-PLAINTEXT-LANG
title: Add plain text as a first-class room language
owner_agent: Frontend Developer + Backend Developer
files:
  - frontend/src/features/room/roomLanguage.ts
  - frontend/src/features/room/RoomCodeEditor.tsx
  - frontend/src/features/room/TopBar.tsx
  - frontend/src/pages/LandingPage.tsx
  - frontend/src/pages/dashboard/dashboardConstants.ts
  - frontend/src/pages/dashboard/dashboardHelpers.ts
  - backend/.../service/LanguageNormalizer.kt
acceptance_criteria:
  - Plain text доступен в селекте на лендинге, в шапке комнаты и в модалке создания задачи.
  - Редактор не ломается на отсутствии grammar (пустой language extension).
  - Бэкенд хранит `plaintext` как самостоятельный ключ.
reviewer_agents: [Solution Reviewer, QA Agent]
```

```yaml
id: TASK-CREATE-LANG-DEFAULT
title: Task creation modal defaults to current language tab
owner_agent: Frontend Developer
files:
  - frontend/src/pages/DashboardPage.tsx
acceptance_criteria:
  - Если активный таб = python, новая задача создаётся в python.
  - Поведение работает для всех 6 языков (включая plaintext).
reviewer_agents: [Solution Reviewer, QA Agent]
```

```yaml
id: TASK-PDF-NON-BLOCKING
title: Non-blocking PDF export for private notes
owner_agent: Frontend Developer
files:
  - frontend/src/features/room/personalNotesPdfExport.ts
  - frontend/src/pages/RoomPage.tsx (state + progress UI)
acceptance_criteria:
  - При 100+ заметках UI остаётся отзывчивым (клик/чекбокс < 1s).
  - Видим прогресс выгрузки.
  - Кнопка disabled на время экспорта (нет дабл-кликов).
reviewer_agents: [Solution Reviewer, Test Reviewer, QA Agent]
```

## 4. Reviewer envelopes

### Solution Reviewer
- ✅ Не нарушает permission model (focus-mode виден только владельцу).
- ✅ Sentinel-маркер идемпотентен (`stripFocusMarker` всегда стрипает).
- ✅ Plain text алиасы синхронизированы на фронте и бэке (один и тот же набор: `plaintext|plain-text|plain_text|plain|text|txt|none`).
- ✅ `tsc --noEmit` clean (0 errors).

### UX Critic
- ✅ Кнопки focus/expand разделены визуально (spacer + правая часть тулбара).
- ✅ Tooltip объясняет действие в обе стороны (вкл/выкл).
- ✅ Кандидат тоже получает локальный fullscreen — нужна возможность спокойно читать длинное ТЗ.
- ✅ Прогресс PDF имеет понятную метку («Готовим документ…», «Раскладываем страницы…», «Сохраняем файл…»).

### Test Reviewer
- Новые e2e: `e2e-briefing-focus-mode.mjs`, `e2e-plaintext-language.mjs`,
  `e2e-task-create-language-default.mjs`, `e2e-pdf-export-progress.mjs`.
- Покрытие сценариев:
  - happy path (включить/выключить focus, развернуть fullscreen, ESC);
  - синк через WS;
  - performance proxy (клик чекбокса < 1.5s во время PDF);
  - регрессия по уже существующему `e2e-markdown-explainer-smoke`.
- npm scripts добавлены в `package.json` (`e2e:briefing-focus`,
  `e2e:plaintext-lang`, `e2e:task-lang-default`, `e2e:pdf-progress`).

### QA Agent
- ✅ Ручной чеклист (предлагается прогнать после деплоя):
  1. Открыть комнату как owner → переключить focus mode → у обоих исчез CodeMirror.
  2. Развернуть markdown на весь экран → ESC возвращает на место.
  3. Lobby: выбрать Plain text → создать комнату → редактор открывается без подсветки.
  4. Dashboard: переключить таб на Python → «Создать задачу» → в селекте Python.
  5. Открыть приватные заметки → добавить 100+ → экспорт PDF → прогресс виден, чекбоксы отвечают, файл скачался.

## 5. Linear-ссылки

При интеграции с Linear эти envelope превращаются в 4 issue:
- `INT-XXX TASK-BRIEFING-FOCUS`
- `INT-XXX TASK-PLAINTEXT-LANG`
- `INT-XXX TASK-CREATE-LANG-DEFAULT`
- `INT-XXX TASK-PDF-NON-BLOCKING`

Под каждый — комментарии Reviewer agents и итоговый QA verdict.

## 6. Out of scope

- Перенос jspdf в Web Worker (потенциальное улучшение).
- Серверная история состояния focus mode для аналитики.
- Sandboxed code runner для plain text (ничего не запускаем).
- Полноценный markdown-paste редактор (drag-n-drop изображений и т.п.).
