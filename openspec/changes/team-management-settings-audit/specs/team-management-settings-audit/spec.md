# Spec Delta

## Purpose

Дать команде проверяемое сервером управление названием, ролями и владением, а
также минимальный приватный журнал этих действий без раскрытия интервью или
персональных секретов.

## ADDED Requirements

### Requirement: Public team-audit vocabulary and private manager audit list

Система SHALL использовать один публичный allowlist `action` для team audit.
Новые production-записи SHALL принимать типизированный `TeamAuditAction`, а не
свободную `String`, и создаваться только с одним из следующих кодов:

| `action` | Смысл для интерфейса |
|---|---|
| `TEAM_CREATE` | Команда создана |
| `INVITATION_CREATED` | Приглашение выпущено |
| `INVITATION_ACCEPTED` | Приглашение принято |
| `INVITATION_REVOKED` | Приглашение отозвано |
| `INVITATION_REISSUED` | Приглашение перевыпущено |
| `TEAM_RENAMED` | Команда переименована |
| `MEMBER_ROLE_UPDATED` | Роль участника изменена |
| `TEAM_OWNERSHIP_TRANSFERRED` | Владение командой передано |
| `LEGACY_UNCLASSIFIED` | Историческое действие без публичного кода |

`LEGACY_UNCLASSIFIED` SHALL быть только безопасной read projection для уже
сохранённого нераспознанного значения; новая mutation не может записать его.
P1 SHALL NOT выдавать в журнале прежнее/новое название, прежнюю/новую роль,
body запроса, receipt, invitation URL/token/envelope, email/login/nickname,
private notes, кандидата, room/interview/grant, business counts, процессы или
детализированный stored result/outcome. Только pagination metadata
`page,size,totalElements,totalPages` разрешён для навигации списка.
Отдельные filters, export, retention policy и дополнительная семантика
«from/to» для действий остаются вне этого change и требуют отдельного
product decision.

Только ACTIVE effective OWNER или ACTIVE stored ADMIN SHALL читать
`GET /api/teams/{teamId}/audit-events?page=&size=`. Путь SHALL принимать
только common pagination: default `page=0,size=25`, `0<=page<=10000`,
`1<=size<=100`;
неизвестный query parameter и `q` SHALL вернуть `400 INVALID_AUDIT_QUERY` без
частичного списка. Ответ SHALL иметь ровно
`{items,page,size,totalElements,totalPages}`. Каждый item SHALL иметь ровно
`{id,action,createdAt,outcome,actor,target,entityId}`:

- `outcome` всегда равен фиксированному публичному значению `SUCCESS`; storage
  outcome не выдаётся даже для historical records;
- `actor` и `target` равны либо `null`, либо ровно
  `{userId,displayName}`; displayName выдаётся только если соответствующий
  пользователь сейчас ACTIVE в этой же команде, берётся только из безопасно
  нормализованного `User.displayName` и при пустом/некорректном значении равен
  нейтральному `Участник` (никогда nickname/login/email);
- `entityId` равен opaque invitation ID только для invitation actions, если
  значение серверно подтверждено как ID invitation этой же команды; иначе он
  равен `null`. URL, token, envelope, hash либо произвольное storage значение
  никогда не может стать entityId;
- `displayName` с Unicode CONTROL или FORMAT code point, включая bidi/zero-width
  символы, считается непригодным и выдаётся как нейтральный `Участник`.

Список SHALL сортироваться `createdAt DESC, id DESC`, не иметь detail
endpoint и не раскрывать storage-only `originTeamId`, raw actor/target foreign
profile fields либо неизвестное stored action значение. Обычное изменение
между страницами может сдвинуть страницу; клиент SHALL дедуплицировать `id` и
предложить refresh, а сервер SHALL NOT удерживать долгую транзакцию.

Все normal и error audit responses SHALL иметь
`Cache-Control: private, no-store`. Неаутентифицированный caller получает
`401`; caller без ACTIVE membership и неизвестная команда получают одинаковый
`404 TEAM_NOT_FOUND`; ACTIVE MEMBER получает
`403 TEAM_AUDIT_FORBIDDEN`. Авторизация выполняется на сервере до query и при
каждой странице; отсутствие audit UI не заменяет это правило.

Pre-implementation acceptance-test level: **backend integration exception**
для точного allowlist, pagination/sort, DTO/privacy/cache и authorization;
**E2E** для manager-visible accessible audit и отсутствия этой поверхности у
MEMBER.

#### Scenario: Управляющий читает безопасный журнал
- **GIVEN** ACTIVE OWNER или ADMIN команды и события из публичного словаря
- **WHEN** он открывает первую страницу журнала
- **THEN** он получает `200` с private no-store, стабильной сортировкой и
  точным allowlisted item DTO
- **AND** секрет ссылки, название до/после, роль до/после и сведения об
  интервью отсутствуют из network response и поверхности интерфейса

#### Scenario: Member и посторонний не получают журнал
- **GIVEN** ACTIVE MEMBER и отдельный caller без ACTIVE membership команды
- **WHEN** каждый вызывает audit list напрямую
- **THEN** MEMBER получает `403 TEAM_AUDIT_FORBIDDEN`, а посторонний тот же
  `404 TEAM_NOT_FOUND`, что и для неизвестной команды
- **AND** ни один ответ не содержит item, total или identity из журнала

#### Scenario: Старое нераспознанное действие не расширяет API
- **GIVEN** в существующем audit storage есть историческая action-строка вне
  публичного allowlist
- **WHEN** доступный manager читает страницу с этой строкой
- **THEN** item имеет `action=LEGACY_UNCLASSIFIED`, nullable safe identities и
  `entityId=null`
- **AND** сервис не выдаёт исходное неизвестное значение и не создаёт новую
  audit запись при таком чтении

#### Scenario: Audit не раскрывает секрет из некорректной invitation записи
- **GIVEN** historical invitation action той же команды содержит URL, token,
  envelope либо несуществующий ID в `opaque_entity_id`
- **WHEN** доступный manager читает страницу
- **THEN** item сохраняет только публичный action, но имеет `entityId=null`
- **AND** исходная секретная строка отсутствует из response и audit read не
  создаёт новую запись

#### Scenario: Глубокая offset-страница отклоняется до чтения
- **GIVEN** manager с ACTIVE manager authority
- **WHEN** он передаёт `page=10001`, отрицательное, переполняющее либо
  нечисловое page значение
- **THEN** получает `400 INVALID_AUDIT_QUERY` с `Cache-Control: private, no-store`
  и без items/total
- **AND** `page=10000,size=100` остаётся допустимым ограниченным окном

### Requirement: Revision-bearing settings read and mutation-safe DTOs

После успешной ACTIVE-membership проверки существующий защищённый
`GET /api/teams/{teamId}` SHALL обратно-совместимо включать текущий team
`revision` вместе с уже выдаваемыми безопасными полями `{id,name,role,epoch,
capabilities}`. Он SHALL иметь `Cache-Control: private, no-store`; revision
является единственным team CAS token для rename и transfer в этом P1.

Во всех P1 management mutation response поле `team` SHALL иметь ровно
`{id,name,role,revision}`, где `role` — заново вычисленная effective role
текущего caller в момент ответа. Поле `member` и каждый элемент
`affectedMembers` SHALL иметь ровно
`{userId,displayName,role,state,revision}`; оно допускает только ACTIVE
membership и не содержит email, login, nickname, epoch, ownerUserId или
profile fields. В ownership-transfer `affectedMembers` содержит ровно два
элемента в фиксированном порядке `[previousOwner,newOwner]`.

При exact authorized idempotency replay сервер SHALL вернуть сохранённый
terminal `outcome`, `recovered=true` и **текущее** безопасное представление
resource. Он SHALL NOT обещать byte-identical historical response: V11 receipt
не хранит snapshot. Любая последующая допустимая mutation может изменить
возвращаемые current `revision`, name или role, но не может создать второй
audit event или вторую domain mutation для этого key.

Pre-implementation acceptance-test level: **backend integration exception**
для revision-bearing read, exact DTO shape и replay-after-subsequent-mutation;
**E2E** для того, что settings UI использует revision read без хранения
authority в browser persistence.

#### Scenario: Settings использует серверную revision и безопасные формы
- **GIVEN** ACTIVE manager читает защищённый team detail перед rename
- **WHEN** он отправляет command с полученной `revision` и получает success
- **THEN** detail и mutation response содержат только предписанные safe поля,
  включая current revision
- **AND** ни initial settings read, ни replay не записывает authority или
  idempotency key в browser persistence

### Requirement: Server-authoritative rename and stored ADMIN/MEMBER lifecycle

Только ACTIVE effective OWNER или ACTIVE stored ADMIN SHALL переименовать
активную команду через `PATCH /api/teams/{teamId}` с
`{name,revision}` и валидным UUID `Idempotency-Key`. `name` SHALL пройти ту же
NFKC+trim и существующую validation/canonicalization, что сохраняемое имя
создания команды. `revision` — текущая team revision. Сервер, а не RTK cache
или видимость кнопки, SHALL повторно проверить ACTIVE membership, роль и team
revision в transaction commit path.

Успех rename SHALL вернуть
`200 {outcome:RENAMED|UNCHANGED,recovered,team}`. `UNCHANGED` означает, что
каноническое имя не меняется: team revision и audit не меняются, но terminal
receipt сохраняется. `RENAMED` SHALL в одной транзакции изменить имя,
increment team revision и merge revision, создать ровно один
`TEAM_RENAMED/SUCCESS` audit event и terminal receipt. Rename SHALL NOT менять
`securityRevision`, любую membership state/role/epoch, room, interview или
grant.

Только текущий ACTIVE effective OWNER SHALL изменить stored role другого
ACTIVE не-владельца через
`PATCH /api/teams/{teamId}/members/{userId}` с
`{role,revision}` и валидным UUID `Idempotency-Key`. `role` допускает ровно
`ADMIN` или `MEMBER`; значение `OWNER` не сохраняется в membership. Для этого
endpoint `revision` — current target membership revision. ADMIN, включая
ADMIN, который был прежним team owner, SHALL получить
`403 TEAM_OWNER_REQUIRED`; current owner как target SHALL получить
`409 OWNER_ROLE_IMMUTABLE`; unknown/inactive target SHALL получить
`404 MEMBER_NOT_FOUND` без state/history. Invalid role SHALL вернуть
`400 INVALID_MEMBER_ROLE` без mutation.

Успех role change SHALL вернуть
`200 {outcome:ROLE_UPDATED|UNCHANGED,recovered,member}`. Если role меняется,
одна transaction SHALL изменить только target stored role и его membership
revision, increment team revision и merge revision, а также создать ровно
один `MEMBER_ROLE_UPDATED/SUCCESS` audit event c safe target. `UNCHANGED` не
создаёт audit и не меняет revisions. Role update SHALL NOT менять current
team owner, securityRevision, membership state/epoch, room ownership,
interview access, grant rows или назначение HIRING/INTERVIEWER.

Все normal/error responses обоих mutation endpoints SHALL иметь
`Cache-Control: private, no-store`. Отсутствующий/невалидный key возвращает
соответственно `400 IDEMPOTENCY_KEY_REQUIRED`/
`400 INVALID_IDEMPOTENCY_KEY` до mutation. Stale team или membership revision
возвращает соответственно `409 TEAM_REVISION_CONFLICT` или
`409 MEMBER_REVISION_CONFLICT` с `currentRevision` только после успешной
авторизации в доступной команде. Active caller с недостаточной ролью получает
`403`; unauthenticated — `401`; foreign/nonmember/unknown team — единый
`404 TEAM_NOT_FOUND`.

Pre-implementation acceptance-test level: **backend integration exception**
для authority, canonicalization, CAS, 24-hour idempotency/restart, atomicity,
audit count и no-access expansion; **E2E** для role-aware rename controls и
error/retry presentation.

#### Scenario: ADMIN переименовывает команду с потерянным ответом
- **GIVEN** ACTIVE ADMIN отправил valid rename с текущей team revision и UUID
  idempotency key, но клиент не получил committed response
- **WHEN** тот же ACTIVE ADMIN повторяет тот же канонический request/key в
  пределах 24 часов
- **THEN** сервер возвращает сохранённый terminal rename outcome с
  `recovered=true` и current safe `team`, не создавая второй audit event или
  новую revision из этого key
- **AND** иной canonical body с тем же key получает
  `409 IDEMPOTENCY_KEY_REUSED` без прежнего body или audit data

#### Scenario: Replay возвращает current representation, не второй mutation
- **GIVEN** ADMIN успешно переименовал команду с key A, затем допустимый
  manager изменил name с отдельным key B
- **WHEN** ADMIN повторяет исходный exact request/key A в пределах 24 часов
- **THEN** ответ имеет исходный terminal `outcome`, `recovered=true` и name /
  revision, актуальные после key B
- **AND** запрос A не изменяет name, revision или audit повторно

#### Scenario: Только owner меняет stored role
- **GIVEN** команда имеет ACTIVE OWNER, ACTIVE ADMIN и ACTIVE MEMBER
- **WHEN** OWNER переводит MEMBER в ADMIN с актуальной membership revision
- **THEN** stored role меняется ровно один раз, effective role в roster
  становится ADMIN и появляется один `MEMBER_ROLE_UPDATED` event
- **AND** попытка ADMIN изменить любую stored role получает
  `403 TEAM_OWNER_REQUIRED` и не меняет state, epoch, grant или audit

#### Scenario: CAS conflict сохраняет draft и не создаёт действие
- **GIVEN** OWNER открыл настройки с revision участника, а другой допустимый
  change уже изменил эту membership
- **WHEN** OWNER отправляет role mutation со старой revision
- **THEN** сервер возвращает `409 MEMBER_REVISION_CONFLICT` с private no-store
  и без audit/receipt mutation
- **AND** интерфейс сохраняет выбранную роль как draft, показывает понятный
  conflict и предлагает refresh вместо тихого overwrite

### Requirement: Atomic current-owner transfer without room or interview expansion

Только текущий ACTIVE effective OWNER SHALL выполнить
`POST /api/teams/{teamId}/ownership-transfer` с
`{targetUserId,revision}` и валидным UUID `Idempotency-Key`. `revision` —
current team revision, а target обязан быть другим ACTIVE участником в этой же
команде в момент commit. Server SHALL lock team before deterministically
locking affected current/target memberships and SHALL recheck actor authority,
current owner ACTIVE membership, target ACTIVE state and revision after every
lock wait. Если legacy data не даёт ACTIVE membership для current
`teams.owner_user_id`, команда завершается fail-closed без receipt/audit/domain
mutation.

Успех SHALL быть одной атомарной transaction:

- `teams.ownerUserId` становится `targetUserId` и effective OWNER существует
  ровно один;
- прежний и новый owner остаются ACTIVE и имеют stored role `ADMIN`;
- team revision и merge revision увеличиваются, а altered membership revisions
  увеличиваются только если их stored role действительно изменился;
- создаётся ровно один `TEAM_OWNERSHIP_TRANSFERRED/SUCCESS` audit event с
  current actor и safe target и один terminal receipt;
- response равен
  `200 {outcome:OWNERSHIP_TRANSFERRED,recovered,team,affectedMembers:[old,new]}`.

Transfer SHALL NOT изменять team membership state или epoch, securityRevision,
room owner, room/interview access, candidate access, grants, invitation state,
назначение HIRING/INTERVIEWER либо историю audit. Он SHALL NOT требовать или
создавать room-owner transfer. Дальнейшие requests старого owner проверяются
по его новой effective ADMIN authority на сервере; UI cache не сохраняет
владение как право.

`targetUserId` текущего owner, unknown/inactive target или race, оставивший
target неактивным, возвращает `409 OWNERSHIP_TRANSFER_TARGET_INVALID` без
mutation/receipt/audit. Stale team revision возвращает
`409 TEAM_REVISION_CONFLICT`. Два конкурирующих transfer с одной revision
допускают только одного winner; проигравший не создаёт partial state или второй
audit event. Lock timeout/temporary serialization returns
`503 TEAM_MANAGEMENT_BUSY` with `Retry-After: 5`. Все ответы имеют
`Cache-Control: private, no-store` и подчиняются той же 401/403/404/key/replay
матрице, что и role mutation. После передачи старый owner, остающийся ACTIVE
ADMIN, не получает его прежний receipt: authority recheck даёт
`403 TEAM_OWNER_REQUIRED` до раскрытия outcome.

Pre-implementation acceptance-test level: **backend integration exception**
для atomic ownership, lock race, exact receipt behaviour and non-expansion;
**E2E** для visible owner-only transfer flow и немедленной role-aware смены
доступных controls после confirmed response.

#### Scenario: Owner передаёт владение активному участнику
- **GIVEN** текущий OWNER и target состоят ACTIVE в одной команде
- **WHEN** OWNER подтверждает transfer с актуальной team revision
- **THEN** response содержит одного нового effective OWNER и два affected
  members со stored `ADMIN`
- **AND** direct inspection доказывает отсутствие изменений epoch, room owner,
  room/interview grants и доступа кандидата

#### Scenario: Одновременная передача не создаёт двух владельцев
- **GIVEN** два transfer request используют одну актуальную team revision
- **WHEN** они достигают commit path одновременно
- **THEN** ровно один request завершается transfer outcome и один owner остаётся
  в storage
- **AND** второй request получает defined conflict/busy outcome без второго
  receipt/audit event и без частичного изменения ролей

#### Scenario: Replay после утраты owner authority не обходит права
- **GIVEN** исходный OWNER успешно передал владение и затем повторяет тот же
  transfer Idempotency-Key в пределах 24 часов
- **WHEN** он всё ещё ACTIVE, но теперь effective ADMIN
- **THEN** сервер возвращает `403 TEAM_OWNER_REQUIRED`, а не recovered outcome
- **AND** receipt, target identity и audit entry не раскрываются этим replay

### Requirement: Accessible role-aware team settings and audit surface

Каждый ACTIVE member SHALL иметь доступный маршрут «Настройки команды» с
текущим безопасным названием команды и effective role. Он SHALL NOT получать
права из client state: каждая mutation и audit request опирается на ответ
сервера. OWNER и ADMIN видят доступную форму «Название команды» и могут
явно отправить rename. Только OWNER видит доступные actions «Изменить роль
участника» и «Передать владение командой»; ADMIN и MEMBER не получают этих
controls. Только OWNER/ADMIN видят «Аудит команды»; MEMBER не видит таб/панель
аудита и не отправляет audit request.

Transfer UI SHALL требовать явного подтверждения выбранного ACTIVE target в
semantic dialog. Dialog имеет имя «Передать владение командой», описывает, что
прежний owner станет ADMIN, и возвращает focus к initiating control при cancel
или terminal response. Role action и rename имеют programmatic label, visible
keyboard focus и target не менее 44×44 CSS px. Loading state имеет accessible
status, error — accessible alert, а конфликт сохраняет draft и предлагает
«Обновить данные»; network/429/5xx/lost-response предлагают явный «Повторить»
с тем же scoped idempotency intent. Клиент SHALL NOT silently generate a new
key, auto-retry a terminal 4xx или write team/audit data into URL/history,
localStorage or sessionStorage.

После successful mutation клиент SHALL invalidate scoped team, roster,
settings and audit queries and re-read current server authority before
rendering controls. После ownership transfer UI старого owner SHALL убрать
owner-only controls, а новый owner SHALL получить их после refresh/entry;
никакой polling или SSE для этого P1 change не требуется. Audit list SHALL
render known public actions as the labels in this spec; it renders
`LEGACY_UNCLASSIFIED` neutrally and never prints storage raw action.

Pre-implementation acceptance-test level: **E2E** для keyboard-only
role matrix, confirmation, retry/conflict and audit privacy presentation;
focused unit/contract tests are permitted only for pure idempotency intent and
API error mapping, not instead of that E2E.

#### Scenario: Member видит безопасные настройки без управляющих прав
- **GIVEN** ACTIVE MEMBER открывает командные settings с клавиатуры
- **WHEN** initial data успешно загружена
- **THEN** он видит team name/effective role, но не видит rename, role-change,
  ownership-transfer или audit controls
- **AND** browser network log не содержит audit request или management mutation

#### Scenario: Owner завершает доступную передачу владения
- **GIVEN** OWNER открыл settings и target ACTIVE в roster
- **WHEN** owner только клавиатурой выбирает target, подтверждает named dialog
  и сервер подтверждает transfer
- **THEN** focus/alert сообщают terminal result, прежние owner-only actions
  исчезают у initiator после server refresh и audit содержит safe action label
- **AND** ни один UI state не утверждает смену владельца до server response

#### Scenario: Audit error не раскрывает защищённые данные
- **GIVEN** ADMIN открывает audit panel, а server возвращает unavailable или
  forbidden outcome
- **WHEN** интерфейс показывает retry/error state
- **THEN** он показывает безопасный accessible alert без previous audit items,
  receipt, target identity или технического stacktrace
- **AND** successful retry читает только текущую permitted page
