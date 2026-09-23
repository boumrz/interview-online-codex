## MODIFIED Requirements

### Requirement: HR export produces a real server-authorized Excel workbook

For PERSONAL records only (`team_id IS NULL`), the system SHALL offer the existing `.xlsx` download to authenticated accounts whose stored `isHr` value is true. Existing `/api/me/hr/rooms` detail/export and `/api/me/rooms` compatibility routes SHALL exclude TEAM records; a direct TEAM identifier SHALL not bypass this boundary. Separate team-context export SHALL follow the added team-scoped export requirement below without requiring global `isHr`. The rest of this requirement and its scenarios concern the retained PERSONAL export. Export SHALL derive its account scope from server-authenticated identity and include only that account's currently permitted tracked rooms, including authorized archived records. It SHALL NOT accept a client-selected HR account as an authorization substitute. A non-HR account, including one with interviewer permission, SHALL be denied this cross-room HR export. Successful output SHALL be a valid Office Open XML workbook, not CSV/HTML renamed as `.xlsx`, and SHALL carry the appropriate download filename and content type. Export SHALL cover the complete requested scope rather than only a visible cabinet page.

Pre-implementation acceptance-test level: **E2E** for browser download and separation between two HR accounts; supplemented by a **backend integration exception** for authentication/authorization attempts and parsing the downloaded workbook as OOXML.

#### Scenario: HR downloads all tracked interviews

- **WHEN** an HR account requests export without date filters
- **THEN** the downloaded workbook contains every retained tracked interview the account is currently authorized to review exactly once
- **AND** it excludes unassigned rooms, candidate-only rooms, and tracked rooms for which permission was lost

#### Scenario: Ordinary interviewer requests HR export directly

- **WHEN** an authenticated non-HR interviewer invokes the HR export operation directly
- **THEN** the server denies the operation without generating an interview workbook

#### Scenario: Export scope exceeds the visible page

- **WHEN** permitted interviews span multiple cabinet pages and HR downloads the current date scope
- **THEN** the workbook includes all matching authorized interviews across those pages with no silent truncation

### Requirement: Workbook exposes the agreed interview summary without private content

The workbook SHALL provide one interview summary row per room with its stable interview identifier, candidate name, position, scheduled time, creation time, first completion time, interview state, archived indicator, current verdict and verdict comment, and effective filter date/source. Existing task scores SHALL be included with their task identity, using a separate detail sheet if more than one task belongs to an interview, so summary rows remain unique. Missing values SHALL remain explicitly unspecified or empty with a documented legend. The export SHALL NOT include another interviewer's private notes, raw candidate activity, session credentials, authentication tokens, or candidate invitation secrets. All user-controlled text SHALL be written as literal cell values rather than spreadsheet formulas or executable external links.

For TEAM exports, the workbook SHALL additionally identify the selected team and each row's track and optional vacancy with stable identifiers and visible names, using explicit absent values where applicable. Its metadata SHALL state “Мои назначения”, the selected team, track/vacancy/status/date filters and timezone. No aggregate across still-independent teams SHALL be produced by this operation. After a successful authorized team merge, export SHALL use the resulting team and current effective assignments, preserving original room identifiers, historical process labels and programme snapshots without introducing grants for other former-team interviews. Team structure metadata SHALL not introduce candidate secrets or content from unassigned interviews.


Pre-implementation acceptance-test level: **E2E** for downloadable visible interview results, supplemented by a **backend integration exception** for workbook schema, multi-task scores, Unicode/newlines, formula-like values, and absence of prohibited fields.

#### Scenario: Interview contains multiple scores and a multiline verdict comment

- **WHEN** HR exports an authorized interview with several scored tasks and a Unicode/multiline verdict comment
- **THEN** the workbook retains one summary row, the current comment, and each existing task score linked to that interview
- **AND** missing scores do not become invented zeroes or an inferred hiring assessment

#### Scenario: A candidate name resembles a spreadsheet formula

- **WHEN** candidate name, position, or verdict comment begins with a formula-like prefix
- **THEN** the workbook stores the exact content as text without an executable formula or external-link relationship

## ADDED Requirements

### Requirement: Team hiring export covers only current assignments and selected filters

В выбранной команде экспорт SHALL быть доступен аутентифицированному активному сотруднику с действующим назначением нанимающего, без требования глобального `isHr`. Назначение только интервьюером, владение командой или знание UUID SHALL NOT открывать этот список/экспорт нанимающего. Выгрузка SHALL включать только интервью текущих действующих назначений нанимающего в одной выбранной команде, включая разрешённые архивные и замороженные записи для чтения. Ни `isHr`, ни прежняя HR-ассоциация, ни владение комнатой после приостановления членства SHALL NOT заменять текущую проверку.

Workbook SHALL быть валидным `.xlsx` и охватывать все записи разрешённой области, соответствующие поиску по кандидату/названию интервью, выбранным треку, вакансии, состоянию и периоду, независимо от пагинации UI. Те же фильтры SHALL применяться к разделу «Кандидаты» и экспорту; «Все» SHALL означать все разрешённые значения только внутри выбранной команды. Дата фильтра SHALL использовать действующий порядок scheduledAt → first completion → createdAt, включительные календарные границы и часовой пояс Europe/Moscow с видимой подписью «МСК» по существующему требованию даты. Пустой разрешённый результат SHALL давать workbook с заголовками и метаданными без подмены областью всей команды. Неполный/неверный период, чужие фильтры и неподдерживаемая область SHALL отклоняться без частичного файла.

Сервер SHALL перепроверять действующие полномочия при чтении данных и непосредственно перед выдачей файла. Отзыв участия/последнего назначения во время генерации SHALL прекращать выдачу; удаление одного из нескольких назначений SHALL требовать построить файл по актуальной разрешённой области либо отказать без выдачи устаревших строк. При ошибке SHALL отображаться повтор без ложного успеха. Экспорт SHALL NOT подключаться к SSE каждой комнаты. Данные, уже скачанные пользователем до отзыва, не могут быть удалены удалённо; это SHALL NOT трактоваться как допустимость новой выдачи после отзыва.

Pre-implementation acceptance-test level: **E2E** для двух команд, аккаунта без isHr, фильтров, пустого результата, загрузки и отказа; **backend integration exception** для разбора OOXML, строк за пределами страницы, прямых legacy запросов, формульного текста и отзыва во время генерации: эти свойства нельзя доказать только видимым списком.

#### Scenario: Два нанимающих имеют разные назначения одной команды
- **WHEN** каждый выгружает свой список с одинаковыми фильтрами
- **THEN** каждый файл содержит только действующие назначения соответствующего аккаунта, а пересечение существует только для совместно назначенных интервью
- **AND** файл явно указывает одну команду и выбранные фильтры

#### Scenario: Командный нанимающий без HR-флага делает экспорт
- **WHEN** активный назначенный сотрудник запрашивает командную выгрузку
- **THEN** допустимый `.xlsx` формируется без изменения глобального профиля
- **AND** обращение к личному HR-экспорту по-прежнему требует личный флаг и не включает командные записи

#### Scenario: Доступ отозван во время генерации
- **WHEN** членство приостановлено или назначение потеряно до выдачи сформированного ответа
- **THEN** сервер не выдаёт файл со строками, к которым доступа больше нет, а UI показывает утрату доступа или необходимость повторить запрос в новой области

#### Scenario: Интервью не помещаются на одной странице
- **WHEN** фильтрам соответствуют разрешённые записи за пределами видимой страницы
- **THEN** все они входят в workbook ровно по одной строке на интервью без молчаливого ограничения количеством видимых строк
