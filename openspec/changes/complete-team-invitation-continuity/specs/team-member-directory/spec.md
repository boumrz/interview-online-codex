# Spec Delta

## Purpose

Дать каждому активному члену команды безопасный и полезный список участников,
чтобы принятие приглашения было видно владельцу и новому сотруднику без
раскрытия частных данных и доступа к интервью.

## ADDED Requirements

### Requirement: Every active team member can read a minimal participant roster

Аутентифицированный ACTIVE OWNER, ADMIN или MEMBER SHALL получить common list
`GET /api/teams/{teamId}/members?page=<page>&size=<size>&q=<optional>` и
увидеть только active membership этой команды. При отсутствующих параметрах
система SHALL использовать `page=0` и `size=25`; `page` SHALL быть
неотрицательным integer, `size` — integer от 1 до 100. `q` SHALL быть trimmed
до максимум 200 Unicode code points и искать только по normalised безопасному
`displayName`, а не по ID, роли, login или другим private fields. Invalid page,
size или q SHALL дать `400 INVALID_LIST_QUERY` без partial list.

Ответ SHALL иметь approved D6 форму
`{items,page,size,totalElements,totalPages}`; totals SHALL относиться к
отфильтрованному результату. Каждый item SHALL содержать стабильный opaque
`userId`, безопасный `displayName` (или нейтральное значение «Участник», если
displayName не задан), effective `role` (`OWNER`, `ADMIN` или `MEMBER`),
`state` и membership `revision`. Каталог SHALL быть стабильно отсортирован
`OWNER → ADMIN → MEMBER`, затем normalised displayName и opaque userId.
Поскольку эта поставка возвращает только active membership, `state` каждого
item SHALL быть `ACTIVE`; интерфейс SHALL показывать current-user marker,
сопоставляя `userId` с уже аутентифицированным текущим actor, без добавления
private profile field в roster DTO. Ответ SHALL NOT содержать nickname, login,
email, authentication/session token, invitation secret, private notes,
кандидатов, комнаты, interview grants, counts, процессы, результаты, audit
details либо данные неактивных участников.

Сервер SHALL проверять ACTIVE membership независимо от отображения интерфейса.
Неаутентифицированный caller получает `401`; caller без ACTIVE membership и
неизвестная команда получают одинаковый неразглашающий `404 TEAM_NOT_FOUND`.
Каждый normal или error response SHALL иметь `Cache-Control: private, no-store`.
Каталог SHALL быть read-only: его чтение не меняет роль, membership, invitation
или interview grant.

Pre-implementation acceptance-test level: **E2E** для отображения раздела
«Участники» каждым active role; **backend integration exception** для прямой
матрицы authorization, active-only фильтра и schema/payload privacy проверки.

#### Scenario: Владелец видит вступившего сотрудника
- **GIVEN** второй аутентифицированный аккаунт принял действующее приглашение
  команды
- **WHEN** OWNER открывает или обновляет раздел «Участники»
- **THEN** каталог содержит нового ACTIVE участника с безопасным displayName и
  его effective role
- **AND** ответ не содержит приглашение, его URL либо данные интервью

#### Scenario: Новый участник видит состав и себя
- **GIVEN** аккаунт успешно вступил в команду по приглашению
- **WHEN** он открывает раздел «Участники» после перехода в эту команду
- **THEN** вместо «Раздел готовится» виден минимальный roster и строка этого
  аккаунта помечена как текущий пользователь
- **AND** каталог не даёт этому аккаунту сведения о чужих интервью или
  приватных логинах

#### Scenario: Неактивный или чужой caller не получает roster
- **GIVEN** caller не является ACTIVE member запрошенной команды либо его
  участие отозвано
- **WHEN** он напрямую запрашивает endpoint каталога
- **THEN** сервер возвращает тот же неразглашающий team-unavailable outcome,
  что и для неизвестной команды
- **AND** payload roster не выдаётся

#### Scenario: Поиск roster использует только безопасное отображаемое имя
- **GIVEN** ACTIVE участник открывает roster с несколькими ACTIVE строками
- **WHEN** он запрашивает страницу без `page`/`size` и передаёт trimmed `q`
  длиной не более 200 символов
- **THEN** ответ использует `page=0,size=25`, содержит approved D6 pagination
  metadata и фильтрует строки только по safe displayName
- **AND** query по opaque ID, роли, nickname, login или email не становится
  отдельным поисковым каналом

#### Scenario: Невалидный common-list query не раскрывает roster
- **GIVEN** ACTIVE участник запрашивает roster команды
- **WHEN** он передаёт отрицательный/нецелочисленный `page`, `size` вне 1–100
  либо `q` длиннее 200 Unicode code points
- **THEN** сервер возвращает `400 INVALID_LIST_QUERY` с
  `Cache-Control: private, no-store`
- **AND** response не содержит partial list или private identity data

### Requirement: Participant UI separates shared visibility from invitation authority

В командном маршруте «Участники» интерфейс SHALL загружать roster при открытии
раздела, возвращении фокуса на страницу и после обычной browser page refresh.
Для текущей поставки page enter/focus/manual refresh достаточны: SSE/polling/
push для мгновенного обновления списка другому уже открытому браузеру SHALL NOT
требоваться. Loading, empty и server-unavailable states SHALL быть явными и не
подменяться ложной заглушкой готовности.

Loading state SHALL иметь accessible status «Загружаем участников»; failure
state — accessible alert «Не удалось загрузить участников» и действие
«Повторить»; фильтрованный empty state — текст «Участники не найдены»; а
постраничная навигация — accessible name «Пагинация участников» и действие
«Следующая страница участников». Эти names являются безопасными публичными
контрактами тестирования и не содержат private identity или invitation secret.

OWNER и ADMIN SHALL видеть приглашения и их разрешённые controls рядом с
каталогом. MEMBER SHALL видеть только roster и SHALL NOT видеть или отправлять
create, reveal, copy, reissue либо revoke invitation mutation. Скрытие этих
controls SHALL NOT заменять server-side authorization и SHALL NOT расширять
room/interview access любой роли.

Pre-implementation acceptance-test level: **E2E** для двух аккаунтов,
отображения roster после accept/page refresh и role-specific controls;
**backend integration exception** для прямых forbidden mutation calls MEMBER.

#### Scenario: Участник не видит заглушку и не получает invite-controls
- **GIVEN** MEMBER открыл доступную ему команду
- **WHEN** он выбирает «Участники» и проходит раздел клавиатурой
- **THEN** виден roster с понятным loading/error state при необходимости, а
  текста «Раздел готовится» нет
- **AND** create, reveal, copy, reissue и revoke controls отсутствуют и
  invitation mutation не отправляется

#### Scenario: Управляющий сохраняет приглашения рядом с roster
- **GIVEN** OWNER или ADMIN открыл «Участники» действующей команды
- **WHEN** roster успешно загрузился
- **THEN** он видит тот же минимальный список участников и разрешённое
  invitation-management surface
- **AND** наличие roster не меняет server-side границы прав доступа к интервью
