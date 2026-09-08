## Context

The previous `shorten-hiring-manager-preview-copy` change deliberately
limited «нанимающий» copy to the room-creation preview. This change supersedes
that *scope boundary* for user-visible Russian role wording: the compact term
now applies throughout the product and API errors. It also replaces the
existing authenticated room-creation textarea, which currently parses a
delimiter-separated UUID draft and previews it asynchronously.

The system already has an authenticated, read-only, single-ID preview
operation at `POST /api/me/hiring-manager-preview`. It establishes current
eligibility server-side and returns only a normalized UUID plus display name
for eligible accounts. The authenticated room-create operation separately
validates submitted IDs atomically.

## Goals / Non-Goals

**Goals**

- Give the role one concise Russian product name in every visible inflection.
- Let a creator explicitly add one verified person at a time, see every
  selected person below the field, remove a selection, and understand
  invalid/unavailable/retryable results before creating a room.
- Keep preview privacy, authorization, and server-authoritative creation
  unchanged.

**Non-Goals**

- Renaming technical symbols, API paths, JSON field names, database columns,
  `isHr`, analytics event keys, test helper identifiers, or class/type names.
- Adding a directory/search, a batch lookup endpoint, a new role, persistence
  for an unsubmitted draft, a realtime/SSE event, or a public/guest picker.
- Changing any account, room owner, interviewer, candidate, or cabinet
  authorization rule.

## Required UX and Copy Contract

### Compact role terminology

The literal word `менеджер` is removed only when it names this role in
Russian text that a user can see, including an API `error` value. The renderer
uses natural forms of `нанимающий` instead:

| Former grammatical role | Required compact form | Example |
| --- | --- | --- |
| nominative singular | `Нанимающий` | `Нанимающий добавлен` |
| genitive singular | `нанимающего` | `ID нанимающего` |
| dative singular | `нанимающему` | `Доступ нанимающему` |
| instrumental singular | `нанимающим` | `Назначить нанимающим` |
| plural nominative | `нанимающие` | `Кандидат и нанимающие` |
| plural genitive | `нанимающих` | `Кабинеты нанимающих` |

The audit applies to rendered frontend literals and server-created, API-visible
error strings. It does not turn technical identifiers into product copy. A
display name supplied by a user is data, not a role phrase, and is not
rewritten.

### Authenticated room-creation picker

The personal dashboard's form has a visible input labelled exactly `ID
нанимающего`, placeholder `UUID нанимающего`, description `Введите ID
нанимающего и нажмите «Добавить».`, and a neighbouring `Добавить` button. It
is a single-value text input, not a textarea, token field, or free-form list.

On `Добавить` (or Enter while the input has focus), the browser performs local
normalization and then asks the existing one-ID preview operation to verify
eligibility. Enter invokes the add action and MUST NOT submit the surrounding
room form. The add action and input are disabled while that one verification
is outstanding; the live status is exactly `Проверяем нанимающего…`.

For a verified account, the client appends one draft selection below the
input, clears the input, and announces exactly `Нанимающий добавлен:
{displayName}`. The list is headed `Добавленные нанимающие`; each entry
exposes its display name and a button visibly labelled `Удалить`, with the
accessible name `Удалить нанимающего {displayName}`. Removal takes effect
locally and immediately, has no network request, and restores no text to the
input.

The following input-level states preserve the typed value so it can be
corrected or retried; none appends a list entry:

| Condition | Exact feedback | Lookup/write behavior |
| --- | --- | --- |
| empty value submitted | `Введите ID нанимающего` | no lookup/write |
| incomplete or malformed UUID | `Введите полный UUID нанимающего` | no lookup/write |
| normalized ID already selected | `Этот нанимающий уже добавлен` | no lookup/write |
| privacy-safe ineligible/unknown result | `Нанимающий не найден или недоступен` | one read-only lookup; no write |
| transient/transport/5xx/throttled preview failure | `Не удалось проверить нанимающего. Повторите попытку.` | one read-only attempt; retry with `Добавить` |

Duplicate detection is case-insensitive and based on the canonical UUID. At
most one selected item and one active request can exist for a canonical UUID.
A response that belongs to a changed authenticated account, route/page
instance, unmounted picker, or obsolete request MUST NOT add a person, clear
the current input, or replace its feedback.

The selected list is an in-memory room-create draft. It does not create a
room, membership, tracked association, profile mutation, analytics write, or
realtime/SSE event. On room submission the client passes the unique canonical
IDs of its current selected list via the established `hiringManagerIds`
payload field. If the server observes an eligibility change before it commits,
it remains the authority: it rejects atomically with its existing status and
the compact, privacy-safe error `Указанный нанимающий не найден или
недоступен`; the client keeps the title, tasks, and selected entries for
correction. The picker controls and removal actions are disabled while room
creation is submitting.

## Architectural Validation Required

The Architect must confirm that the existing single-ID preview contract is
sufficient for sequential picker verification and that moving the dashboard
state to a selected canonical-ID list does not alter the established
room-create payload contract. The Architect must also confirm cancellation or
generation-guard placement for obsolete responses, including logout/account
changes, and that the existing server-side room validation remains the only
authorization authority.

## Security, Reliability, and Accessibility Constraints

- The browser must not infer eligibility from a role flag, cached preview,
  display name, or client state. It must submit only the existing payload and
  let the server decide again when creating the room.
- Existing preview authentication, strict request parsing, no-store/referrer
  headers, opaque unavailable result, response minimization, and no-write
  guarantees remain mandatory. No batch/search capability is introduced.
- The public and guest create surfaces show neither picker nor preview result;
  direct unsupported assignment input remains rejected by the server.
- Success, pending, and error changes are exposed through an accessible live
  status/error region. Labels and buttons have programmatic names; colour is
  not the only state signal; keyboard Enter adds rather than submits the
  room; each remove button names its target.
- Picker state is local and disposable. Navigation/reload/logout must not
  restore an unverified or removed selection. No reconnect behavior is needed
  because the picker creates no realtime state; a late HTTP response is
  ignored rather than replayed.

## Risks / Trade-offs

- **Broad copy replacements can change an identifier or test fixture instead
  of product copy** — limit implementation scope to rendered literals/API
  error values and use an allow-listed source audit for technical names.
- **A selected preview can become stale before creation** — retain the
  existing atomic server validation, privacy-safe correction feedback, and
  no optimistic room assignment.
- **Input and surrounding form may compete for Enter** — assert the explicit
  keyboard behavior in E2E.
- **A failed check can discard a user-entered UUID** — tests require retaining
  the input for every non-success state and clearing it only after a verified
  append.
- **A response races navigation or a replacement attempt** — require a
  request/page/account generation guard and integration/E2E coverage of an
  obsolete response.

## Migration / Rollback

No data migration or release sequencing is required. The UI state changes are
per-page and the established payload is backward compatible. Rollback returns
the prior wording and textarea behavior only; it does not undo any room that
was already server-created.
