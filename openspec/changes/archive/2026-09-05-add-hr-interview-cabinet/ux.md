# HR interview cabinet UX specification

Status: designed for UX Critic review. Visual companion: [storyboard.html](storyboard.html).

## Experience principles

The HR capability extends the current dark Mantine cabinet and room UI. It uses the existing neutral surfaces, compact controls, blue focus border and white primary actions. HR is an account capability, not a room role: show it as `HR` in the personal cabinet and as the existing `Интервьюер` role inside a room. The room owner keeps the existing visually distinct owner marker and owner-only controls.

The shortest critical path is unchanged: a guest creates a room on the landing page and lands directly in the editor; a candidate opens an invite link and joins as candidate. Neither path introduces an HR prompt. HR controls appear only after server-confirmed manager admission.

## User flows

### A. New HR account

1. On `Регистрация`, the user optionally checks `Я HR-менеджер` below the password field.
2. `Создать аккаунт` submits once and shows its existing pending state.
3. The user lands in the personal cabinet. The navigation includes `HR-кабинет` and the profile card includes the account UUID plus `Скопировать HR ID`.
4. Selecting `HR-кабинет` opens `Кандидаты и интервью` without a route-level reload.

The checkbox is unchecked by default. It does not reveal candidate/interviewer role choices and does not alter room admission.

### B. Existing user enables HR

1. The profile shows an unchecked `Я HR-менеджер` control and `Включить HR-функции`.
2. Selecting and submitting updates the stored profile. While pending, both controls are disabled and the button reads `Включаем…`.
3. On success, announce `HR-функции включены`, reveal the HR ID/copy control, and add `HR-кабинет` to navigation without requiring login again.
4. If enabling fails, retain the checked control and show an inline error with `Повторить`.

No disable affordance is shown in this MVP.

### C. Manager records an interview and assigns HR

1. A server-confirmed owner or interviewer enters the room. The header keeps the existing role chip (`Владелец` or `Интервьюер`) and shows `Кандидат и HR` in the manager controls area, separate from the editor and step controls.
2. `Кандидат и HR` opens a modal. Metadata and HR assignment are separate labelled sections.
3. The manager enters `Имя кандидата`, optional `Позиция`, and `Дата и время интервью (МСК)`, then chooses `Сохранить сведения`.
4. Successful save keeps the modal open and announces `Сведения сохранены` next to the save action.
5. The manager enters `ID HR-специалиста` and chooses `Добавить HR`. Success clears the ID field and updates the assigned-HR list. Repeating an assignment remains a success.
6. A candidate never sees the trigger or receives the private metadata in room UI.

### D. Metadata conflict

1. A stale save returns a conflict while retaining every local field value.
2. A non-destructive alert says: `Сведения изменил другой менеджер. Ваши изменения сохранены в форме.`
3. `Загрузить актуальные сведения` fetches the latest server values. Before replacing the draft, its label explicitly states the effect; activation replaces the local fields and revision.
4. The user can instead leave the modal or manually copy values. There is no automatic overwrite, merge, or blind retry.

### E. HR reviews and opens interviews

1. `HR-кабинет` opens `Кандидаты и интервью` and requests page 1, all-time scope.
2. Initial loading uses table-shaped skeleton rows. A successful empty request shows `Пока нет интервью`.
3. `Обновить список` discovers external assignments. During refresh, keep existing rows visible, mark the list `Обновляем…`, disable only the refresh button, and set `aria-busy=true` on the results region.
4. A failed refresh keeps existing rows with `Данные не обновлены` and the last successful rows must not be presented as current.
5. An active row offers `Открыть комнату` and `Результаты`. An archived row offers only `Результаты`; it never offers live-room entry.
6. `Результаты` opens a read-only `Результаты интервью` modal fetched from the HR detail endpoint. `Закрыть` returns focus to that row’s trigger.

### F. Filter and export

1. The two date inputs are labelled `Период с` and `Период по`; helper text says dates and boundaries use Moscow time. Both are required together.
2. `Применить период` validates a complete, non-reversed pair. On success it refreshes the list from page 1 and changes the scope summary to the inclusive selected dates.
3. `За всё время` clears both inputs, returns to all retained history and page 1, then refreshes.
4. A successful filtered list with zero rows says `За выбранный период интервью нет` and retains the filters.
5. `Скачать Excel` exports the currently applied scope across all pages. Pending label: `Готовим Excel…`; do not auto-retry.
6. On download success announce `Excel скачан: N интервью`. For zero rows announce `Excel скачан: интервью нет`; the valid heading-only workbook still downloads.
7. On failure show an inline alert and `Повторить скачивание`. A workload error asks the user to select a shorter period; a busy error asks them to retry later.

## Screen specifications

### Registration and profile

- Registration keeps the existing centered card. Add the HR checkbox between password and the primary action, with supporting copy: `Добавит личный список интервью. Права в комнатах выдаются отдельно.`
- Profile keeps its current two-column card. HR capability appears as a distinct subsection after display-name controls. Enabled state shows a monospace, selectable UUID and `Скопировать HR ID`.
- Copy success changes the button label to `Скопировано` for about two seconds and announces it in a polite live region. If Clipboard API is denied/unavailable, select the UUID text, keep it visible, and show `Не удалось скопировать. ID выделен — скопируйте вручную.`
- HR navigation is absent until the server-synced profile says `isHr=true`. It is a button/tab with selected state and does not imply room authority.

### Room: `Кандидат и HR` modal

- Desktop width: 640–720 px; mobile: full viewport width with internal scrolling and sticky footer actions.
- Header: title, one-sentence privacy explanation, close button.
- `Сведения о кандидате`: three labelled fields and save status. Candidate name and position allow 200 Unicode characters; show remaining/limit feedback only near the limit. Blank optional values are saved as unspecified.
- The `datetime-local` value is interpreted and displayed as Moscow civil time. The UI converts to/from an instant with `Europe/Moscow`; it must not use the device timezone. Supporting text always contains `МСК`.
- `HR-специалисты`: assigned list with name, truncated UUID plus copyable full value, and owner badge where applicable. No removal control in this MVP.
- Invitation errors appear below the ID field. Malformed, unknown and non-HR IDs share `HR-специалист с таким ID не найден`. Keep the submitted ID so it can be corrected.
- Close via `Закрыть`, header close, or Escape unless a save/add request is pending. While pending, prevent accidental close and explain with disabled controls rather than discarding input.
- If manager permission is lost, close and clear the private panel, announce that access changed, and hide the trigger. Archived state renders fields and assigned HRs read-only if reached before terminal navigation, with `Комната в архиве. Изменения недоступны.`

### HR cabinet

- Header row: title `Кандидаты и интервью`, short scope/timezone description, HR ID and copy button on wide screens; stack on narrow screens.
- Toolbar: date group, `Применить период`, `За всё время`, then actions `Обновить список` and `Скачать Excel`. Destructive styling is not used.
- Table columns at desktop: `Кандидат`, `Позиция`, `Комната`, `Дата интервью`, `Статус`, `Действия`. Candidate is the primary cell; room title is never used as a candidate substitute.
- Missing candidate/position/date reads `Не указано`. Date values use `ru-RU` formatting with an explicit `МСК` suffix. A tooltip/accessible description identifies whether the effective date came from schedule, first completion, or creation when relevant to filtering/export.
- Badge precedence: `Архив` overrides any upcoming treatment; otherwise `Завершено` for finished; `Предстоящее` only for unfinished, non-archived, future scheduled time; `Просрочено` for unfinished, non-archived elapsed schedule; `Активно` for unfinished without schedule. Never infer attendance or completion from schedule.
- Pagination is below the table, retains applied filters, and announces the visible range. Out-of-range empty pages return to the last valid page after a refresh.
- At widths below 720 px, each row becomes a card with the same field labels; actions are full-width and remain ordered `Результаты`, then `Открыть комнату` when allowed.

### Results modal

- Header contains candidate name or `Кандидат не указан`, room title, state and archive badges.
- Summary shows position, scheduled time, first completion time, current verdict and verdict comment. Missing fields say `Не указано`; do not infer zero scores or verdicts.
- `Оценки по задачам` lists step number/title and nullable score. Private notes, activity, credentials and invite links are absent.
- The body is read-only. The only footer action is `Закрыть`. Archived detail includes a persistent `Архивная запись — открыть комнату нельзя` callout.

## Component behavior and interaction rules

| Control              | Enabled when                              | Pending behavior                              | Success                                        | Error                                               |
| -------------------- | ----------------------------------------- | --------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `Скопировать HR ID`  | UUID is present                           | none                                          | temporary `Скопировано` + live announcement    | select UUID + manual-copy message                   |
| `Сохранить сведения` | manager, active room, data changed, valid | disable modal mutation controls; `Сохраняем…` | update revision; `Сведения сохранены`          | retain draft; field/server error; conflict action   |
| `Добавить HR`        | manager, active room, nonblank ID         | disable ID/action; `Добавляем…`               | refresh list, clear field, polite announcement | retain ID and show safe inline error                |
| `Обновить список`    | cabinet visible and no refresh running    | keep prior rows; `Обновляем…`                 | replace rows and freshness state               | retain rows with stale warning or error empty state |
| `Применить период`   | both valid dates or both blank            | results region busy                           | page 1 with applied scope                      | keep inputs and current applied data                |
| `За всё время`       | a filter is applied or draft dates exist  | clear then fetch page 1                       | all-time scope                                 | show recoverable load error                         |
| `Скачать Excel`      | valid applied scope and no export running | `Готовим Excel…`; keep list usable            | browser download + count announcement          | no file; retry action                               |
| `Результаты`         | row visible and detail idle               | open modal skeleton                           | read-only detail                               | modal error with `Повторить` and `Закрыть`          |

Requests submit once per activation. Enter submits the focused form section only: metadata save in metadata fields, HR add in the HR ID field, period apply in date filters. Escape never closes a pending modal. Error messages receive focus only for blocking form validation; background refresh/download messages use live regions without stealing focus.

## State matrix

| Surface            | Loading                                       | Empty                                                       | Success                                 | Error / recovery                                               | Reconnecting / stale / terminal                                                                            |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Registration       | primary pending; fields retained              | N/A                                                         | cabinet with HR state                   | inline auth error; retain checkbox                             | N/A                                                                                                        |
| Profile HR         | subsection skeleton with profile              | ordinary account opt-in                                     | UUID and HR nav visible                 | checked draft retained; `Повторить`                            | account switch clears HR UI until new profile resolves                                                     |
| Room panel         | modal skeleton after confirmed manager role   | metadata `Не указано`; assigned list `HR пока не добавлены` | editable sections and save/add feedback | inline fetch/save/invite errors with retry                     | 409 keeps draft + explicit reload; role loss closes/clears; archive read-only/terminal                     |
| Cabinet list       | first-load skeleton; table header visible     | `Пока нет интервью`                                         | rows, totals, filters, pagination       | `Не удалось загрузить интервью` + `Повторить`                  | refresh keeps old rows labelled stale; no polling/SSE                                                      |
| Filtered list      | skeleton only if no prior result              | `За выбранный период интервью нет`                          | filtered rows and scope summary         | validation stays by inputs; load retry preserves applied range | pending draft dates do not relabel existing results                                                        |
| Results detail     | modal skeleton                                | scores: `Оценок нет`                                        | factual, read-only result               | `Не удалось загрузить результаты` + `Повторить`/`Закрыть`      | archived callout; 404 closes sensitive content after acknowledgement                                       |
| Export             | `Готовим Excel…`                              | valid empty workbook + count message                        | file and count message                  | explicit failure + manual retry                                | 429 shows retry-later; never auto-retry or claim success                                                   |
| Live archived room | existing content freezes while status checked | N/A                                                         | N/A                                     | N/A                                                            | after one persisted 410 check: banner, disable mutations, stop reconnect, link to HR cabinet if authorized |

## Accessibility and responsive requirements

- All action-label strings above are accessible names, not tooltip-only labels. Every input has a persistent visible label.
- Modal focus starts on the title/first actionable field, is trapped, and returns to its trigger. Errors are associated through `aria-describedby`; results/list regions use `aria-busy` and named status regions.
- Status is conveyed by text and icon as well as color. Maintain at least 4.5:1 text contrast and visible 2 px keyboard focus against the dark surface.
- Table headers remain semantic on desktop. Mobile cards preserve equivalent labelled data and reading order. Touch targets are at least 44 px; no horizontal page scroll at 320 px.
- Long names, room titles, UUIDs, comments and Unicode wrap without covering controls. The full value remains accessible by text selection or labelled detail, not hover alone.
- Reduced-motion mode removes nonessential transitions. Loading skeletons do not pulse when reduced motion is requested.

## Explicit scope boundaries and implementation notes

The cabinet refreshes only on entry, manual refresh, filter/page change, or page reload. It does not subscribe to room streams or poll. HR assignment does not create owner identity, expose private notes, or grant access to rooms solely because `isHr` is enabled. Guest create/join, current interview-step switching, incoming task updates without reload, and owner-only language selection retain their existing room behavior and layout; the new manager modal stays outside those editor controls.

Visual mocks intentionally show account/profile, room modal/conflict, and cabinet/results states. They are interaction references, not new visual tokens or production code.
