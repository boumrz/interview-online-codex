# Матрица покрытия интерактивного прототипа

Статус: authoritative repo-hosted prototype для OpenSpec `design-team-interview-journey`. Текущий исполнимый слой покрывает **1.6a–1.6f / DA-01–DA-06 / UX-01–13**.

Точка входа: [`index.html`](index.html). Все URL ниже — hash routes внутри статического прототипа. Верхняя тёмная панель всегда маркирует артефакт как прототип; локальные действия не вызывают API, не меняют production-данные и не являются доказательством серверной авторизации.

## Как воспроизвести 1.6a–1.6f

Из корня репозитория:

```sh
python3 -m http.server 4173 --directory openspec/changes/design-team-interview-journey/prototypes
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6a/automated-check.mjs
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6b/automated-check.mjs
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6c/automated-check.mjs
PROTOTYPE_URL=http://127.0.0.1:4173/hiring.html node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6d/automated-check.mjs
PROGRAMMES_PROTOTYPE_URL=http://127.0.0.1:4173/programmes.html node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6e/automated-check.mjs
MERGE_PROTOTYPE_URL=http://127.0.0.1:4173/merge.html node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6f/automated-check.mjs
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6g/mobile-safari-orientation-fallback-check.mjs
```

Панели «Сценарий роли», «Состояние данных» и «Длинный русский текст» позволяют менять ветку без перезапуска. На экране приглашения отдельная строка демонстрационных состояний открывает preview, expired, revoked, network error и already accepted.

## UX / journey / acceptance

| ID | Контракт | Route / anchor | Роли | Состояния | Проверяемый переход и ограничение | Evidence 1.6a |
|---|---|---|---|---|---|---|
| A01 | UX-01, DA-01, AC-01 entry | `#/personal/interviews` | personal | loading, empty, error, success | Единый список и текстовая кнопка «Создать интервью»; личное кандидатское участие не получает manager actions | `state-personal-success.png`, `state-personal-no-teams.png`, `report.json.states` |
| A02 | UX-01, journey шаг 1 | кнопка переключателя в shell | personal | empty, success | Пользователь без команд видит только personal и «Создать команду»; Atlas не изображается доступным | `report.json.personalWorkspaceChoices` |
| A03 | UX-02, team-workspaces create | `#createTeamDialog` | personal → OWNER | validation error, pending, success/empty | Trim/1–100, ошибка и фокус сохраняются; после локальной симуляции видны новая команда и роль владельца; трек не обязателен | `report.json.createValidation`, `report.json.createSuccess`, `shell-*` |
| A04 | UX-01/02, journey шаг 1 | переключатель: personal / Atlas / Orbit | MEMBER, ADMIN, OWNER | success | Переключается явная область; одинаковое имя не используется как ID, показаны короткие ID; тип списка сохраняется либо открываются «Интервью» | `report.json.roleAssertions`, keyboard trace |
| A05 | UX-01, rights visibility | `#/teams/atlas/interviews?actor=member` | MEMBER without room/hiring grant | loading, empty, error, revoked, success | «Кандидаты» и «Настройки команды» скрыты; отдельный HIRING actor включает candidates только по назначению | `state-team-member-loading.png`, `state-team-revoked.png`, `evidence/1.6b/report.json.roles` |
| A06 | UX-01, D3 role boundary | `#/teams/atlas/interviews?actor=admin` | ADMIN without room grant | empty, success | Настройки команды доступны; «Кандидаты» без назначения скрыты; подпись объясняет, что team role не даёт room access | `state-team-admin-empty.png`, `report.json.roleAssertions` |
| A07 | UX-01, D3 role boundary | `#/teams/atlas/interviews?actor=owner` | OWNER without implicit candidate scope | error, success | OWNER визуально отличим; settings доступны; team ownership не выдаётся за доступ к чужим кандидатам | `state-team-owner-success.png`, `state-team-error.png`, `report.json.roleAssertions` |
| A08 | UX-03, journey profile | `#/profile?fromTeam=0|1` | personal, MEMBER, ADMIN, OWNER | loading, error, revoked/session-ended, success | Профиль — отдельный экран; имя, `isHr`, стабильный личный ID и logout; кнопка возвращает в прежнее пространство | `state-profile-success.png`, `state-profile-error.png`, route assertions |
| A09 | UX-03, isHr explanation | `#profileName`, switch «Я нанимающий» | authenticated account | success, save error | Под переключателем явно сказано: только личные интервью; введённое имя остаётся при ошибке | `state-profile-error.png`, keyboard report |
| A10 | UX-02, D4 invitation privacy | `#/join/team?actor=anonymous&invite=preview` | anonymous | loading, preview, network error, expired/revoked | До входа видны только team name, MEMBER role и срок; нет каталога, кандидатов, комнат или creator identity | `state-invite-anonymous.png`, `state-invite-error.png`, `state-invite-expired.png`, `report.json.invitePrivacy` |
| A11 | UX-02, auth return | `#/sign-in?return=invite` → `#/join/team?...actor=invited` | anonymous → invited account | preview | Вход возвращает к тому же preview; участие не создано, остаётся отдельная кнопка явного принятия и смена аккаунта | `state-invite-account.png`, `report.json.returnedToInvite` |
| A12 | UX-02, explicit accept | `data-accept-invite` | invited account | pending → success | До подтверждения UI не объявляет членство; после локальной симуляции показывает MEMBER и объясняет отдельные room assignments | `state-invite-success.png`, interactive trace in `report.json` |
| A13 | UX-02, unavailable/repeat | invitation scenario strip | invited, MEMBER | expired, revoked, already accepted | Expired/revoked не смешаны с network error; повтор тем же участником не создаёт второе участие | `state-invite-expired.png`, `state-invite-revoked.png`, `state-invite-already-member.png` |
| A14 | UX-01, AC-01 old-route matrix | `#/prototype/routes` | personal | success | Все восемь legacy entries ведут в эквивалентный route; `/dashboard/rooms` лишь открывает форму; нет `created=1` или другого side effect | `state-old-route-map.png`, `report.json.oldRoutes` |
| A15 | UX-10, DA-01 geometry | все shell routes | all 1.6a roles | long RU + success | 11 viewport × 4 zoom: no document horizontal overflow, видимые targets ≥44×44, responsive drawer | 44 `shell-*.png`, `report.json.matrix` |
| A16 | UX-01/10 keyboard | mobile shell / dialogs | all | success, validation error, iPhone landscape fallback | Skip link, selectors, явная mobile-menu button, visible focus; Escape закрывает drawer/dialog; invalid team name возвращает focus в поле. На iPhone Safari landscape касание текстового поля профиля перехватывается до focus и показывает «Для ввода поверните iPhone вертикально» без submit/mutation | `report.json.keyboard`, `report.json.createValidation`, `evidence/1.6g/mobile-safari-orientation-fallback-report.json` |
| A17 | UX-10 visual viewport | create team dialog / profile | personal | long RU, keyboard-height simulation, orientation fallback | Portrait keyboard simulation сохраняет достижимость последнего действия. Keyboard-closed landscape остаётся доступен с safe-area/44px; native landscape input для iPhone Safari не заявлен, возврат в portrait сохраняет draft и требует нового явного focus | `report.json.keyboardSimulation`, `viewport-zoom-report.md`, `evidence/1.6g/mobile-safari-orientation-fallback-report.json` |

### DA-02 / UX-04–07

| ID | Контракт | Route / anchor | Роли | Состояния | Проверяемый переход и ограничение | Evidence 1.6b |
|---|---|---|---|---|---|---|
| B01 | UX-04, journey шаг 2 | `#/teams/atlas/tracks` | MEMBER, ADMIN, team OWNER | loading, empty, filter-empty, error, conflict, archived, revoked, success | Треки/вакансии показывают только число доступных смотрящему интервью; управляющие действия только ADMIN/OWNER | `tracks-admin.png`, `tracks-conflict.png`, `tracks-archive.png`, `report.json.roles` |
| B02 | UX-04 process detail | `#/teams/atlas/tracks/frontend` | all active team roles | caller-empty, success | «Мои интервью в этом процессе» не расширяет grant; пустое состояние говорит о текущем пользователе, не всей команде | `track-member-process-empty.png`, `report.json.states` |
| B03 | UX-04 archive/programme placeholder | track cards / process detail | MEMBER reader, ADMIN, team OWNER | NONE, published, archived | Архив запрещает новые привязки и сохраняет историю; карточка программы различает NONE и published, не проектируя полный UX-12 | `tracks-admin.png`, `tracks-archive.png` |
| B04 | UX-05 task library | `#/teams/atlas/library?tab=tasks` | MEMBER, author, ADMIN, team OWNER | loading, empty, filter-empty, error, conflict, archived, revoked, success | Поиск/язык/archive без track/vacancy filter; MEMBER читает/копирует, author/admin/owner редактируют | `library-member.png`, `library-filter-empty.png`, `library-archive.png`, `report.json.memberLibrary/authorLibrary` |
| B05 | UX-05 sets | `#/teams/atlas/library?tab=sets` | MEMBER, author, ADMIN, team OWNER | empty, stale item, success | Набор — versioned ordered selection без треков; stale task отмечена адресно до применения | `library-sets.png` |
| B06 | UX-05 personal copy publication | `#/personal/library?publish=1` | personal author | review, success | По умолчанию ничего не публикуется; явны destination team и последствие «доступно всем»; original остаётся personal | `personal-publish-copy.png` |
| B07 | UX-05 CAS conflict | `#/teams/atlas/library/tasks/task-1/edit` | author, ADMIN, team OWNER | edit, HTTP 409 conflict | Локальные title/condition переживают 409, hash-navigation и возврат; actual v4 не подменяет draft v3 | `library-conflict.png`, `report.json.taskConflict` |
| B08 | UX-06 unified interview list | `#/teams/atlas/interviews` | room OWNER, INTERVIEWER, HIRING | loading, empty, filter-empty, error, conflict, archived, frozen, revoked, success | Search + track/vacancy/state filters; planned/unfinished/finished/archive/frozen различимы; scheduled time не превращается в «идёт сейчас» | `interviews-room-owner.png`, `interviews-filter-empty.png`, `interviews-archive.png` |
| B09 | UX-06 permission boundary | same route | MEMBER, author, ADMIN, team OWNER without room grant | success / caller-empty | Team role без назначения показывает «У вас нет доступных интервью»; HIRING видит Candidates, остальные — только по отдельному grant | `interviews-admin-no-grant.png`, `report.json.roles` |
| B10 | UX-07 one-page form | `#/teams/atlas/interviews/new` | active MEMBER / creator | loading, error, conflict, revoked, success | Пять последовательных блоков: context, candidate/time, people, programme/tasks, summary; выбор до submit ничего не назначает | `create-programme.png`, `create-conflict.png` |
| B11 | UX-07 context integrity | `#formTrack`, `#formVacancy` | creator | success | Смена трека явно очищает несовместимую vacancy; «Без трека» отключает vacancy; draft сохраняется | `report.json.interviewConflict.contextReset` |
| B12 | UX-07 programme resolver placeholder | query `programme=published|none|draft|archived` | creator | published, NONE, blocked draft/archive | Published mandatory rows locked; extras separate; NONE permits free selection; draft/archive block submit without free fallback | `create-programme.png`, `create-free.png`, `create-draft-blocked.png`, `report.json.programmeResolver` |
| B13 | UX-07 people/privacy | form section 03 | creator, room OWNER | active member, pending invite | Owner fixed, interviewer/hiring separate, hiring does not require `isHr`; pending invitations have no invented identity and cannot be selected | `create-programme.png` |
| B14 | UX-07 409/navigation | create form + `#unsavedDialog` | creator | dirty, stay, leave, conflict | Dirty switch shows «Остаться» / «Уйти без сохранения»; draft never moves to another team; 409 retains title/candidate | `create-conflict.png`, `report.json.interviewConflict` |
| B15 | UX-06/07 preparation | `#/teams/atlas/interviews/int-204` | room OWNER, INTERVIEWER, HIRING | success, conflict, archived/revoked | Same record exposes context, people and task snapshots; room OWNER edits metadata/extras, INTERVIEWER/HIRING see allowed read/actions | `preparation-room-owner.png`, `preparation-interviewer.png` |
| B16 | UX-10, DA-02 geometry/keyboard | rotating UX-04–07 routes + personal shell/drawer | all 1.6b roles | long RU + full state set + simulated 47 px landscape safe areas + iPhone fallback | 44 viewport/zoom measurements plus 20 representative screenshots; no global overflow/undersized targets. На iPhone Safari landscape task/interview text fields не получают focus и не отправляют форму; draft/scope сохраняются, fallback и viewing actions имеют ≥44px, portrait требует нового focus | `evidence/1.6b/report.json.matrix`, `compactForm`, `safeArea`, `keyboard-report.md`, `evidence/1.6g/mobile-safari-orientation-fallback-report.json` |

### DA-03 / UX-08

| ID | Контракт | Route / anchor | Роли | Состояния | Проверяемый переход и ограничение | Evidence 1.6c |
|---|---|---|---|---|---|---|
| C01 | UX-08, AC-11 room shell | `#/room/int-204` | guest manager, room OWNER, INTERVIEWER, HIRING | loading, success | Самостоятельная room shell без workspace sidebar; видимая кнопка возвращает в исходный personal/team список | `room-owner-work.png`, `report.json.roles` |
| C02 | UX-08, DA-03 W/H modes | room `data-mode`, explicit mode buttons | room managers | Focus, Work, Overview | Mode использует фактические W/H: default Work при W≥1000/H≥440; Focus иначе; Overview только явно при W≥1320/H≥640 | `bounding-rectangles.json.matrix`, `room-owner-overview-both.png` |
| C03 | UX-08 panel minima | Overview + «Показать оба» | room managers | success | Steps слева, editor в центре, activity над chat; editor 480×320, steps 240×240, activity 320×240, chat 320×320/history 120 проходят реальные измерения | `report.json.overview`, `room-owner-overview-both.png` |
| C04 | UX-08 direct surfaces | room area navigation | guest manager, room OWNER, INTERVIEWER, HIRING | success | Постоянный порядок: Редактор, Шаги, Условие, Мои заметки, Чат, Активность; из steps/condition чат и activity доступны одним действием | `focus-trace.json`, `report.json.keyboard` |
| C05 | UX-08 step semantics / authority | persistent `data-room-current-step` + steps | room OWNER, INTERVIEWER с подтверждённой room-role; candidate, guest manager и HIRING denied | local selected / published | Локальный и опубликованный кандидату шаги различимы во всех manager panels, включая editor/chat; input mode дублирует их непосредственно над focused composer; resize/panel switch не публикует; «Переключить кандидату» рендерится только для room OWNER/INTERVIEWER и отсутствует у candidate, guest manager, HIRING и revoked staff | `report.json.currentStepContext`, `report.json.roles.*.publishControl`, `current-step-chat.png`, `report.json.continuity.selectedStepPreserved` |
| C06 | UX-08 internal context labels | chat / activity / notes panels | room managers | empty, success, error | «Чат интервьюеров», «Активность кандидата», «Мои заметки» разделены; audience чата явно исключает кандидата; error не подменён empty | `pending-chat.png`, `activity-error.png`, `report.json.roles` |
| C07 | UX-08, AC-12 attention | chat history + unread jump | room managers | unread, read-at-bottom, new message | Новое сообщение не перехватывает focus/scroll; unread растёт вне конца истории и сбрасывается только после явного перехода к новым | `report.json.attention` |
| C08 | UX-08 reconnect honesty | room banner + local panel errors | room managers | pending, reconnecting, error, success | Pending не выдан за sent; reconnect сохраняет drafts; activity/chat retry локален и editor остаётся доступен | `pending-chat.png`, `reconnecting-work.png`, `activity-error.png` |
| C09 | UX-08 terminal access | `#/room/int-204?...state=frozen|archived|revoked` | room OWNER, INTERVIEWER/HIRING, candidate, revoked staff | frozen, archived, revoked | Frozen/archived останавливают live actions; revoke удаляет manager shell/drafts и прекращает retry; candidate получает privacy-safe unavailable | `frozen-owner.png`, `revoked-staff.png`, `report.json.revoke` |
| C10 | UX-08 candidate boundary | `#/room/int-204?actor=candidate` | candidate | success, reconnecting, error, frozen | Candidate видит опубликованную задачу и свой editor, но не manager switcher/chat/activity/notes/team directory | `candidate-no-internal-panels.png`, `report.json.roles.candidate` |
| C11 | DA-03 continuity | 20 panel switches + five resizes | room OWNER | Overview→Work→Focus | Тот же editor DOM node, room session и instance; code, cursor/selection, editor scroll, notes/chat drafts и local step сохранены без remount | `report.json.continuity` |
| C12 | UX-10, DA-03 iPhone Safari input boundary | portrait input; keyboard-closed landscape; direct landscape tap; portrait→landscape during focus | room manager | Focus / orientation fallback | Portrait input/composer остаётся поддержан. В iPhone Safari landscape любое room text input перехватывается до focus: native keyboard не открывается, показывается доступный «Для ввода поверните iPhone вертикально», viewing/navigation остаются ≥44px. При повороте во время portrait-ввода draft, room session, active panel, local/published step, selection и scroll сохраняются; focus снимается без Send, после возврата portrait нужен новый tap. Старый one-gesture runway сохранён только как историческое evidence неуспешного подхода и не является поддерживаемым iPhone-путём | `evidence/1.6g/mobile-safari-orientation-fallback-report.json`, `evidence/1.6g/mobile-safari-orientation-fallback-pre-fallback-red-report.json`, `evidence/1.6g/screenshots/automated-tenth-da-03-*`, `scroll-runway-report.json` (historical) |
| C13 | UX-10, DA-03 geometry/focus | full matrix / phone focus trace | all room roles | long RU + success + fallback | 44/44 viewport×zoom, targets ≥44×44, no global overflow; 10/10 keyboard steps named and visibly outlined; iPhone fallback дополнительно проверяет обе safe-area стороны и отсутствие runway/mutation | `bounding-rectangles.json`, `focus-trace.json`, `report.json`, `evidence/1.6g/mobile-safari-orientation-fallback-report.json` |

### DA-04 / UX-09 и UX-11

Standalone entry: [`hiring.html`](hiring.html). Он открывается из командных разделов «Кандидаты» и «Участники» в authoritative `index.html` как top-level документ, чтобы hash routes, native dialog focus и viewport measurements не искажались iframe-контекстом.

| ID | Контракт | Surface / route | Роли | Состояния | Проверяемый переход и ограничение | Evidence 1.6d |
|---|---|---|---|---|---|---|
| D01 | UX-09, DA-04 | `hiring.html#/teams/atlas/candidates` | HIRING isHr=false/true, MEMBER, ADMIN/OWNER без room grant, assigned INTERVIEWER | loading, empty, filter-empty, error, revoked, success | Только текущий HIRING видит строки; personal isHr не меняет team grant; строка — интервью, не профиль человека | `evidence/1.6d/report.json.roleMatrix`, `screenshots/candidates-*` |
| D02 | UX-09, DA-04 | `hiring.html#/teams/atlas/candidates/room-204` | HIRING, assigned INTERVIEWER, MEMBER, ADMIN/OWNER без grant | loading, empty result, error, revoked, archived, success | Результат доступен только через назначенное интервью; отсутствие оценки не равно нулю, private notes исключены | `report.json.resultMatrix`, `screenshots/result-*` |
| D03 | UX-09, DA-04 | export dialog | current HIRING | ready, forming, empty workbook, retryable error, too large, busy, revoked, success | List/export используют один filter signature; success появляется только после формирования; revoke очищает scope | `report.json.filterParity`, `report.json.exportLifecycle`, `screenshots/export-*` |
| D04 | UX-11, DA-04 | `hiring.html#/teams/atlas/members` | HIRING, MEMBER, ADMIN, OWNER, assigned manager | loading, roster empty, filter-empty, process error, revoked, success | Проекция содержит только track/vacancy IDs и names — без candidate, count, room ID, time и result | `report.json.projectionPrivacy`, `screenshots/members-*` |
| D05 | UX-11, DA-04 | caller-only process list | all active team roles | loading, empty/filter-empty, error, revoked, success | Link сохраняет только caller actor и process IDs, не identity коллеги; пустое состояние не раскрывает чужие интервью | `report.json.callerOnlyNavigation`, `screenshots/process-*` |
| D06 | UX-10, DA-04 | cross-surface geometry / keyboard / iPhone fallback | representative roles | long RU + full state set | 44/44 viewport×zoom, no document overflow, visible targets ≥44×44; 28/28 sampled controls named/focused. Hiring filter draft/scope survives both iPhone Safari landscape fallback branches without applying filters | `evidence/1.6d/viewport-zoom-report.md`, `keyboard-report.md`, `report.json.matrix`, `evidence/1.6g/mobile-safari-orientation-fallback-report.json` |

### DA-05 / UX-12

Standalone entry: [`programmes.html`](programmes.html). Authoritative `index.html` открывает его из «Треков и вакансий» как top-level документ.

| ID | Контракт | Роль / route | Проверяемое различие | Evidence 1.6e |
|---|---|---|---|---|
| E01 | UX-12, DA-05 · published | MEMBER reader · manage/published | Действующая v3, origin/digest, обязательный порядок, read-only и отдельный draft | `screenshots/member-published.png`, `report.json.roleEvidence.member` |
| E02 | UX-12, DA-05 · NONE / first draft | ADMIN · manage/none/firstDraft | Только NONE допускает free choice; first draft блокирует создание и разрешает discard лишь до первой публикации | `screenshots/admin-none.png`, `admin-first-draft.png`, `report.json.interactionEvidence.discard` |
| E03 | UX-12, DA-05 · publish/conflict | ADMIN/OWNER · publishedDraft/duplicate/stale | v3 остаётся действующей; v4 future-only; duplicate/stale адресны, publish disabled, draft сохранён | `screenshots/admin-published-draft.png`, `duplicate-source.png`, `stale-publish.png` |
| E04 | UX-12, DA-05 · inheritance/update | MEMBER/OWNER · vacancyInherited/vacancyUpdate | Vacancy pin сохраняет track v3; v4 попадает только в draft после явного обновления и новой публикации | `screenshots/vacancy-inherited.png`, `vacancy-update.png` |
| E05 | UX-12, DA-05 · archive/restore | ADMIN/OWNER · archived/restored | Archive блокирует новые интервью без fallback; restore отдельный, старые комнаты сохраняют снимки | `screenshots/programme-archived.png`, `programme-restored.png` |
| E06 | UX-12, DA-05 · create | room creator · createPublished/createNone/createDraft/createArchived/createConflict | Published даёт immutable foundation+extras; NONE свободен; draft/archive блокируют; v3→v4 сохраняет поля до review | `screenshots/create-*.png`, `report.json.assertions.createIntegrity` |
| E07 | UX-12, DA-05 · room | room creator · programmedRoom | Pinned v3 остаётся при team v4; structure/context locked, solution editable, extras distinct | `screenshots/programmed-room.png`, `report.json.interactionEvidence.room` |
| E08 | UX-10, DA-05 · states/geometry | все четыре роли | loading/empty/error/revoked/success; 44/44 viewport×zoom, 20/20 screenshots, ≥44px, focus, 20 resize cycles; iPhone Safari create-field fallback сохраняет programme scope/draft и не создаёт room | `evidence/1.6e/report.json`, `viewport-zoom-report.md`, `keyboard-report.md`, `evidence/1.6g/mobile-safari-orientation-fallback-report.json` |

### DA-06 / UX-13

Standalone entry: [`merge.html`](merge.html). Он открывается только для team OWNER из настроек команды в authoritative `index.html`. Верхняя панель позволяет воспроизвести стороны, блокеры и terminal states; это локальная модель взаимодействия, не доказательство server authorization, atomic commit или redirect guard.

| ID | Контракт | Route / anchor | Роли | Состояния | Проверяемый переход и ограничение | Evidence 1.6f |
|---|---|---|---|---|---|---|
| F01 | UX-13, AC-21 · exact target | `#/merge?...step=target&exact=1` | source OWNER | success, error | Только доступный select или точный ID; глобального поиска нет; неизвестный и недоступный ID дают одну нейтральную ошибку и focus в поле | `screenshots/exact-target-long.png`, `report.json.assertions.exactTarget` |
| F02 | UX-13 · request/review boundary | `step=request` → destination `step=inbox` → `step=plan` | source OWNER, destination OWNER | loading, empty, declined, success | До разрешённого открытия скрыто имя назначения; review context не считается approval; decline не создаёт план | `screenshots/request-name-hidden.png`, `destination-inbox.png`, `report.json.assertions.requestPrivacy/reviewOpening` |
| F03 | UX-13 · identity/direction | `step=plan&phase=teams` | оба OWNER | success, long RU | Источник, назначение, устойчивые ID и итоговое имя показаны явно; изменение имени создаёт новую revision | `report.json.assertions.staleAfterEdit`, matrix long-RU rows |
| F04 | UX-13 · membership/role collisions | `phase=members&blocker=membership` | оба OWNER, same OWNER | success, conflict | Dual membership dedupe; destination roles сохраняются; source OWNER/ADMIN не повышаются автоматически; ACTIVE vs SUSPENDED/LEFT/REMOVED блокирует мастер | `screenshots/members-dedup-conflict.png`, `report.json.assertions.blockerEvidence.membership` |
| F05 | UX-13 · name/material collisions | `phase=names` | оба OWNER | success | Трек требует явного rename; одинаково названные задачи остаются отдельными по ID/origin/author | `screenshots/name-collisions.png` |
| F06 | UX-13, D3 privacy | `phase=review`, pre-review request, blockers | оба OWNER, non-owner | success, revoked | План не содержит перечня/количества интервью, кандидатов, времени, результата, room ID/tasks, чата/activity/private notes; non-owner и старый unauthorized URL не получают target identity | `screenshots/review-private.png`, `revoked-non-owner.png`, `redirect-unauthorized.png`, `report.json.assertions.requestPrivacy/nonOwner` |
| F07 | UX-13 · approvals/revision | `phase=approval` | source OWNER, destination OWNER | success, conflict/stale | Две отдельные отметки одной rev/digest; каждая сторона подтверждает только свою; изменение плана очищает обе; approval явно не commit | `screenshots/approval-stale.png`, `report.json.assertions.dualApproval/staleAfterEdit` |
| F08 | UX-13 · same owner/feature flag | `phase=approval&actor=sameOwner&commit=0|1` | same OWNER, destination OWNER | success | Один человек может намеренно поставить две различимые отметки; финальный запуск остаётся отдельным, требует обе отметки, destination owner и `FEATURE_TEAM_MERGE_COMMIT` | `report.json.assertions.dualApproval/sourceOwner/destinationOwner` |
| F09 | UX-13, AC-22 · commit blockers | `phase=approval&blocker=live|recovery|persistence|busy|membership` | destination OWNER | error/conflict | Live session, recovery, persistence, MERGE_BUSY и membership conflict различимы и нейтральны; ни один не показывает partial/success | `screenshots/blocker-live.png`, `failure-busy.png`, `report.json.assertions.blockerEvidence/failure` |
| F10 | UX-13 · commit/result | `step=commit` → `step=result` | destination OWNER, same OWNER | pending, error, success | Commit — отдельный экран; success только после confirmed receipt; failure/busy оставляют команды раздельными; source становится MERGED, undo не обещан | `screenshots/commit-progress.png`, `confirmed-result.png`, `report.json.assertions.commitProgress/result/failure` |
| F11 | UX-13 · old route | `step=redirect&authorized=1|0` | authorized member, non-owner/revoked | revoked, success | Старый scope проверяет current rights; разрешённый пользователь получает новый route, запрещённый не видит имя/ID назначения | `screenshots/redirect-authorized.png`, `redirect-unauthorized.png` |
| F12 | UX-10, DA-06 · states/geometry | rotating merge routes | все четыре merge-роли | loading, empty, error, conflict, revoked, success, long RU, iPhone fallback | 44 viewport×zoom; без global overflow, все видимые targets ≥44×44 и названы; 14/14 focus steps. iPhone Safari landscape не фокусирует exact target/name fields: plan revision/role choice остаются прежними, commit не запускается, fallback находится внутри обеих safe-area сторон | `evidence/1.6f/report.json`, `bounding-rectangles.json`, `focus-trace.json`, `visual-viewport-keyboard.json`, `evidence/1.6g/screenshots/automated-tenth-da-06-direct-landscape-fallback.png` |

## Матрица ролей 1.6a

| Роль прототипа | Personal | Team navigation | «Кандидаты» в Atlas | Team settings | Invite action | Privacy note |
|---|---|---|---|---|---|---|
| anonymous | нет authenticated shell | нет | нет | нет | login/register с возвратом | только team name / role / expiry |
| personal user, no teams | интервью / библиотека / personal candidates по `isHr` | только create-team explanation | нет | нет | открывает login/account path | команда не возникает от чтения ссылки |
| invited account | личный аккаунт до принятия | нет до server-confirmed success | нет | нет | сменить аккаунт / явно принять | preview не содержит team directory |
| MEMBER without extra grant | доступно при переключении | interviews, library, tracks, members | скрыто | скрыто | already-member | team role не означает room ownership |
| ADMIN, no room grant | доступно при переключении | interviews, library, tracks, members, settings | скрыто | да | already-member | team admin не видит чужих candidates |
| OWNER, no implicit candidate scope | доступно при переключении | interviews, library, tracks, members, settings | скрыто | да | already-member | team owner не изображается room owner автоматически |

Дополнительная матрица 1.6b вводит task author, room OWNER, INTERVIEWER и HIRING как независимые сценарии. Только HIRING включает «Кандидаты»; room OWNER/INTERVIEWER/HIRING получают строки интервью; MEMBER/author/ADMIN/team OWNER без room grant видят caller-scoped empty. Production permission enforcement остаётся предметом RED/GREEN и backend integration, а не этого HTML.

Матрица 1.6c добавляет candidate, guest manager и revoked staff. Candidate получает только published condition + собственный editor; guest manager возвращается в личное пространство; room OWNER/INTERVIEWER/HIRING получают внутренние панели по отдельному room assignment. Revoked staff не получает manager room DOM и retry. Это демонстрация видимых границ, а не доказательство backend audience filtering.

Матрица 1.6f добавляет source OWNER, destination OWNER, same OWNER и non-owner. Первый подтверждает только сторону источника; второй — сторону назначения и только после двух отметок может запустить commit; same OWNER ставит две различимые отметки одним намеренным действием; non-owner/revoked не получает plan revision, target identity, approval или commit controls. Все границы остаются prototype-only и требуют server-side доказательств в последующих RED/GREEN задачах.

## Матрица состояний 1.6a

| Поверхность | loading | empty | error | revoked / expired | success |
|---|---|---|---|---|---|
| Personal interviews | skeleton + `aria-busy` | первое интервью + видимый create | retry, не выдаёт stale за empty | session-ended применяется в profile/auth | доступные personal rows и candidate-role row |
| Team interviews | skeleton + `aria-busy` | onboarding не перекрывает список | retry + stale warning | защищённое содержимое удалено, personal остаётся | assigned rows, явная team/role |
| Profile | skeleton | не применяется: настройки имеют значения | ввод сохранён + retry semantics | session ended, team data скрыты | account-only form + stable ID |
| Invite | skeleton | не применяется: неизвестный token не называется empty | network error + retry | одна privacy-safe формулировка expired/revoked | preview / pending / accepted / already-member |
| Legacy entry | route-map loading относится к shell | не создаёт данных | destination page error state доступен через toolbar | auth/server проверяются заново | target route + source notice |

## Матрица состояний 1.6b

| Поверхность | loading | empty | filter-empty | error / conflict | archived / revoked | success |
|---|---|---|---|---|---|---|
| Tracks/vacancies | skeleton | no active tracks, create по роли | reset filter | duplicate/stale edit keeps input | archive read/history; revoked clears | nested vacancies + caller-only counts |
| Tasks/sets | skeleton | create in explicit scope | reset search/language | network retry; CAS 409 keeps draft | restore по роли; revoked clears | tasks/sets, role-specific actions |
| Interview list | skeleton | caller has no assigned rows | reset list filters | stale warning without empty | archive read-only; revoked clears | lifecycle rows and caller role |
| Create form | resolver/loading | NONE means explicit free mode, not generic empty | not applicable | network receipt guidance; 409 keeps draft | archived programme blocks; revoked clears | five blocks, pinned mandatory + extras |
| Preparation | skeleton | not applicable for known interview | not applicable | metadata revision conflict | archive read-only; revoked clears | one record, scoped actions |

## Матрица состояний 1.6c

| Поверхность | loading / empty | pending | reconnecting / error | frozen / archived | revoked | success |
|---|---|---|---|---|---|---|
| Room shell | access skeleton, не empty | общий ACK-status; draft не считается sent | общий connection banner; локальные retry истории | отдельная read-only/terminal карточка | manager DOM и protected drafts очищены | режим по W/H + возврат в workspace |
| Chat | «Сообщений пока нет» | composer хранит текст, submit disabled до ACK | existing history stale-marked, retry локален | отправка прекращена | panel/draft/pending отсутствуют | unread/read-position + явный jump |
| Activity | «Действий пока нет» | не применяется | stale history сохранена, retry не блокирует code | live history закрыта | panel/history отсутствуют | отдельная исходная история, load-more сохраняет scroll |
| Notes | пустой личный draft допустим | save имеет локальное ожидание только как prototype | draft не теряется при layout | editor закрыт | draft очищен | один editor заметки текущего local step |
| Candidate | initial room loading | локальные code changes без ложного ACK | нейтральный connection status | privacy-safe unavailable | privacy-safe unavailable без team cause | опубликованное condition + собственный editor, без internal panels |

## Матрица состояний 1.6f

| Поверхность | loading / empty | error | conflict / blocker | revoked | success |
|---|---|---|---|---|---|
| Exact target / requests | skeleton; явное «Запросов нет» | одинаковая unavailable формулировка без directory leak | decline не создаёт plan | запросы/target очищены | точный request и отдельное открытие review context |
| Merge plan | skeleton | draft сохранён, команды раздельны | stale revision очищает approvals; membership требует внешнего исправления | plan DOM и target identity отсутствуют | последовательные Teams → Members → Names → Review → Approval |
| Approval / commit | loading не имитирует approval | failure до receipt не success | live/recovery/persistence/busy блокируют commit нейтрально | действия и детали отсутствуют | две отметки одной rev, отдельный flag и отдельный commit |
| Result / old route | outcome pending только на commit-экране | нет partial result | неизвестный outcome возвращает к проверке, не дублирует успех | unauthorized old URL без target name/ID | один confirmed receipt; authorized redirect после current check |

## Responsive / zoom набор

- Viewports: 1440×900, 1366×768, 1280×720, 1024×600, 1024×480, 768×1024, 1024×768, 320×640, 360×640, 390×640, 667×375.
- Zoom: 100%, 125%, 150%, 200% для каждого viewport.
- Content stress: длинные русские имя пользователя, team name и interview title включены в каждой geometry-итерации.
- DA-01 automated gate: 44/44 комбинаций; 61 historical screenshots, 17 representative state cases, 0 runtime/page errors.
- DA-02 automated gate: 44/44 rotating UX-04–07 geometry combinations; 20 representative screenshots; 0 runtime/page errors; 18/18 keyboard focus steps named and visibly outlined; simulated 47 px left/right safe-area PASS for closed personal shell and open drawer.
- DA-03 automated gate: 44/44 room viewport×zoom combinations; 15 representative screenshots; 0 runtime/page errors; 10/10 room keyboard focus steps named/outlined; Overview internal minima PASS.
- DA-03 continuity: один editor DOM node/session/instance сохраняется через 20 switches и пять повторяющихся resize-профилей; code, selection 41–77, scrollTop 260, local step и оба drafts совпали после цикла.
- DA-03 visualViewport regressions: portrait 390×360/320, Safari auto-pan 667×260 и detector-independent keyboard 667×60/effective 44. В short keyboard mode остаётся одна верхняя 44 px строка: шесть прямых room actions + textarea/Send; current/published context встроен в верхние 15 px textarea cell. Native visual-origin proxy сообщает `offsetTop=19`, но fixed anchor остаётся 0; отдельный layout-coordinate auto-pan proxy сохраняет anchor=92. Pointer-intercepting accessory занимает остаток viewport, поэтому `elementFromPoint` проверяет верхнюю и нижнюю точки каждого target, а lower-edge click выполняет Editor→Chat и повторный focus. History возвращается после blur; CSS-short closed не менялся. Safe-area 47 px, ≥44 px, focus/DOM/draft и overflow=0 сохранены.
- DA-04 automated gate: 44/44 viewport×zoom, 33 representative screenshots, 0 page errors, all targets ≥44×44, 28/28 sampled controls named; privacy/filter/revoke assertions PASS.
- DA-05 automated gate: 44/44 viewport×zoom, 20/20 representative screenshots geometry-valid, 0 runtime errors, all targets ≥44×44/named; programme lifecycle/inheritance/conflict/mandatory-extras и 20 resize cycles PASS.
- DA-06 automated gate: 44/44 viewport×zoom, 14 representative screenshots, 0 runtime errors, all visible targets ≥44×44/named; exact target, privacy, roles, revision, dual approval, flag, blockers, receipt и redirect assertions PASS.
- Keyboard-height simulation: 390×360, focus в последнем поле team-create, primary action после `scrollIntoView` полностью внутри visual viewport, safe-area variable присутствует.
- Ограничение: Chromium headless и уменьшение viewport не являются реальной экранной клавиатурой. Manual supported mobile browser/device остаётся обязательным gate 1.6g у UX Critic.

## Ограничения этого поручения

DA-01–DA-06 имеют repo-hosted интерактивное покрытие. Headless Chromium, CSS zoom и simulated visual viewport не заменяют manual supported mobile/device gate 1.6g. Никакая geometry-проверка прототипов не заменяет будущие AC-01+ E2E, realtime/Yjs, programme-integrity, merge atomicity или server-side permission tests.
