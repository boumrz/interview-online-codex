# Spec Delta

## Purpose

Обеспечить создателю каждой ожидающей ссылки-приглашения безопасное
восстановление того же адреса без скрытой ротации и без постоянного хранения
bearer-секрета в браузере.

## ADDED Requirements

### Requirement: Managers receive a URL-free paginated invitation lifecycle list

ACTIVE OWNER или ADMIN SHALL получить manager-only пагинированный
`GET /api/teams/{teamId}/invitations`. Список SHALL содержать все состояния
приглашений `PENDING`, `ACCEPTED`, `REVOKED` и `EXPIRED`, быть стабильно
отсортирован `createdAt DESC, id DESC` и использовать существующий common
pagination contract. Каждый item SHALL иметь **ровно** поля
`{id,state,role,expiresAt,revision,canReveal,linkRecoverability}`, где
`state ∈ {PENDING,ACCEPTED,REVOKED,EXPIRED}` и
`linkRecoverability ∈ {RECOVERABLE,UNRECOVERABLE_LEGACY,NOT_APPLICABLE}`.
`EXPIRED` SHALL be an effective DTO projection of an expired persisted `PENDING`
record whose recoverable envelope has been cleared; the persisted database state
set remains exactly `PENDING`, `ACCEPTED` and `REVOKED`.

`canReveal=true` SHALL быть только когда текущий caller одновременно является
ACTIVE OWNER/ADMIN, `creator_user_id` этой записи, invitation остаётся
`PENDING` и его secret имеет `RECOVERABLE` representation. Список SHALL NOT
содержать raw URL, token, ciphertext/envelope, creator ID или любое foreign
identity/private interview data. Обычные create/reissue/list DTO SHALL быть
URL-free. Все normal и error ответы list SHALL иметь
`Cache-Control: private, no-store`.

Неаутентифицированный caller получает `401`; ACTIVE MEMBER получает
`403 INVITATION_MANAGEMENT_FORBIDDEN`; caller без ACTIVE membership и
неизвестная команда получают один и тот же `404 TEAM_NOT_FOUND`. Эти ошибки
SHALL NOT содержать metadata, URL, secret или причину отсутствия доступа.

Каждая manager-visible lifecycle-карточка SHALL быть доступна как
`role="article"` с безопасным accessible name `Приглашение <invitationId>`.
Внутри неё issuer-visible controls SHALL иметь accessible names «Показать
ссылку», «Копировать ссылку», «Закрыть ссылку», «Перевыпустить ссылку» и
«Отозвать приглашение» по соответствующему разрешённому состоянию; открытое
секретное поле SHALL называться «Одноразовая ссылка». `invitationId` допустим
в accessible name как opaque non-secret identifier, но URL/token туда не
попадает.

Pre-implementation acceptance-test level: **E2E** для списка manager-а и
видимой lifecycle карточки; **backend integration exception** для точной
schema, статусов, pagination/sort, field allowlist, cache headers и прямой
матрицы authorization.

#### Scenario: Manager читает безопасную историю ссылок
- **GIVEN** команда имеет приглашения во всех четырёх lifecycle состояниях
- **WHEN** её ACTIVE OWNER или ADMIN открывает management surface
- **THEN** он видит пагинированный список, отсортированный `createdAt DESC, id DESC`,
  с точными безопасными полями каждого item
- **AND** ни URL, ни token, ни creator identifier не отображаются и не
  возвращаются list API

#### Scenario: Member не получает metadata приглашений
- **GIVEN** ACTIVE MEMBER состоит в команде
- **WHEN** он напрямую запрашивает invitation list
- **THEN** сервер возвращает `403 INVITATION_MANAGEMENT_FORBIDDEN` с
  `Cache-Control: private, no-store`
- **AND** response не раскрывает invitation metadata или secret

### Requirement: Only the current creator can explicitly reveal a recoverable pending link

Создатель активного recoverable `PENDING` приглашения SHALL получить тот же
URL только через явный user-initiated запрос
`GET /api/teams/{teamId}/invitations/{invitationId}/link`. Успешный ответ
`200 {url}` SHALL содержать `Cache-Control: private, no-store` и
`Pragma: no-cache`. После reload, remount, успешного copy или скрытия ссылки
интерфейс SHALL восстановить безопасную metadata-карточку и явное действие
«Показать ссылку» для создателя; raw URL SHALL NOT загружаться автоматически.
Успешное «Копировать ссылку» SHALL NOT менять state, удалять current issuer
view или посылать create/reissue/revoke mutation.

Reveal SHALL применять следующую неразглашающую матрицу. Каждый success/error
ответ SHALL иметь `Cache-Control: private, no-store`; он SHALL NOT содержать
raw URL/token/envelope, кроме `url` в success body.

| Condition | Required outcome |
|---|---|
| unauthenticated caller | `401` |
| unknown team или caller без ACTIVE membership | `404 TEAM_NOT_FOUND` |
| ACTIVE MEMBER | `403 INVITATION_MANAGEMENT_FORBIDDEN` |
| ACTIVE manager, но не creator; missing, terminal, expired или legacy/unrecoverable invitation | `410 INVITATION_LINK_UNAVAILABLE` без reason |
| corrupt/unknown key version, decrypt failure или token-hash mismatch | `503 INVITATION_LINK_RECOVERY_UNAVAILABLE`, `Retry-After: 5` |
| lock timeout/conflict | `503 INVITATION_BUSY`, `Retry-After: 5` |

Raw URL SHALL NOT persist in `localStorage`, `sessionStorage`, browser history,
route URL, telemetry, logs, traces, metrics or user-facing audit. It may exist
only in the current issuer-only revealed view and clipboard after explicit copy.

Pre-implementation acceptance-test level: **E2E** для explicit reveal после
copy/reload и current issuer view; **backend integration exception** для всей
error/cache/privacy matrix, creator identity, key/decrypt/hash failures and
lock conflict.

#### Scenario: Создатель повторно копирует ту же ссылку после перезагрузки
- **GIVEN** OWNER или ADMIN выпустил recoverable `PENDING` приглашение
- **WHEN** он успешно копирует ссылку, перезагружает страницу команды и явно
  выбирает «Показать ссылку»
- **THEN** система возвращает тот же exact URL с private no-store headers и не
  отправляет create или reissue mutation
- **AND** raw URL отсутствует из browser persistence, route URL и history

#### Scenario: Другой manager не может раскрыть чужой секрет
- **GIVEN** ADMIN A создал recoverable `PENDING` приглашение, а OWNER B или
  ADMIN B состоит в той же команде
- **WHEN** B отправляет прямой reveal request для invitation A
- **THEN** сервер отвечает `410 INVITATION_LINK_UNAVAILABLE` без URL, secret
  или причины
- **AND** B сохраняет разрешённые ему manual reissue/revoke actions

#### Scenario: Recovery infrastructure fails closed
- **GIVEN** creator отправляет reveal для recoverable `PENDING` invitation
- **WHEN** server не может найти key version, расшифровать envelope или
  подтвердить token hash
- **THEN** сервер возвращает `503 INVITATION_LINK_RECOVERY_UNAVAILABLE` с
  `Retry-After: 5`
- **AND** existing invitation не перевыпускается и raw secret не раскрывается

### Requirement: Multiple invitations remain independent and only explicit per-link reissue rotates one

Владелец или администратор SHALL вручную выпускать несколько независимых
`PENDING` приглашений одной команды. Новый valid create с уникальным
`Idempotency-Key` SHALL создать отдельный bearer-token и SHALL NOT заменить,
отозвать, раскрыть или изменить любой уже существующий invitation. Точный
`Idempotency-Key` replay SHALL вернуть тот же logical outcome и SHALL NOT
создать вторую запись.

Только явный `POST /api/teams/{teamId}/invitations/{invitationId}/reissue`
текущего OWNER/ADMIN SHALL ротировать выбранный invitation. Он SHALL
атомарно отозвать прежнюю запись, очистить её recoverable envelope и создать
replacement с новым token/creator. Copy, reload, reveal, list и create другой
ссылки SHALL NOT ротировать эту запись. Старый URL SHALL перейти в generic
unavailable outcome. Accept, revoke и scheduled/current-access expiry SHALL
атомарно очистить envelope; expiry SHALL сериализоваться как effective
`EXPIRED` DTO state, не изменяя persisted `PENDING` database state.

Legacy `PENDING` запись без envelope SHALL оставаться usable получателю по уже
известному URL, но metadata SHALL показывать
`linkRecoverability=UNRECOVERABLE_LEGACY`; creator получает normal manual
reissue без автоматической замены. Для ACCEPTED, REVOKED и EXPIRED записей
`linkRecoverability=NOT_APPLICABLE` и `canReveal=false`.

Pre-implementation acceptance-test level: **E2E** для independent create и
manual per-link reissue; **backend integration exception** для terminal
envelope cleanup, persisted expiry, lost-response/idempotency, concurrent
accept/reissue/revoke/cleanup and legacy migration.

#### Scenario: Второй выпуск не меняет первую ссылку
- **GIVEN** команда имеет первую recoverable `PENDING` ссылку
- **WHEN** OWNER или ADMIN выпускает вторую ссылку с уникальным idempotency key
- **THEN** обе ссылки остаются отдельными `PENDING` records
- **AND** последующий reissue первой делает unavailable только первую исходную
  ссылку, не меняя вторую

#### Scenario: Terminal invitation больше нельзя раскрыть
- **GIVEN** ссылка была ACCEPTED, REVOKED или EXPIRED
- **WHEN** её бывший создатель открывает invitation list либо вызывает reveal
- **THEN** metadata показывает `canReveal=false` и
  `linkRecoverability=NOT_APPLICABLE`
- **AND** reveal возвращает `410 INVITATION_LINK_UNAVAILABLE` без причины или
  сведений о принявшем аккаунте

#### Scenario: Lock conflict не раскрывает URL
- **GIVEN** reissue, accept, revoke или expiry cleanup держит invitation lock
- **WHEN** другой lifecycle или reveal запрос не получает lock в заданный срок
- **THEN** сервер возвращает `503 INVITATION_BUSY` с `Retry-After: 5`
- **AND** response не возвращает raw URL, secret, partial state или replacement
  invitation
