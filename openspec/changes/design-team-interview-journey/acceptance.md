# План приёмки реализации

Это обязательные сценарии тестов, а не отчёт об их прохождении. Фактический статус каждого теста определяется checkbox в `tasks.md` и RED/GREEN evidence в `implementation-verification.md`. Перед production-реализацией соответствующего поведения разработчик пишет тест, запускает его и фиксирует RED, вызванный отсутствующей функциональностью, а не поломанной средой. После минимального изменения тот же тест должен пройти.

## Набор участников и данных

В тестовой среде используются два изолированных пространства Atlas и Orbit; Анна — владелец Atlas и нанимающая отдельных интервью без глобального `isHr`; Борис — обычный сотрудник и владелец конкретной комнаты; Вера состоит в обеих командах; Максим — администратор Atlas без назначения на интервью; Денис входит кандидатом. Дополнительный сотрудник с совпадающим displayName проверяет выбор по устойчивому ID. Личные комнаты и личный нанимающий с `isHr=true` служат проверкой совместимости.

Для объединения добавляется Backend с другим владельцем, совпадающими участниками, именами треков/наборов, архивными и приостановленными комнатами, действующими и отозванными grants. Отдельные fixtures содержат конфликт source ACTIVE / destination SUSPENDED, LEFT, REMOVED. Для стандартов задаются пресет, базовая программа Frontend и дополнительная программа вакансии с несколькими опубликованными версиями.

Данные создаются отдельно для каждого запуска и не берутся из реальных интервью. Одинаковое имя кандидата в двух комнатах не означает одну личность. Для тестов прав используются отдельные browser contexts и серверные сессии, а не подмена клиентского флага.

## Design acceptance до production RED

Authoritative design artifact — versioned repo-hosted `prototypes/index.html` внутри этого change; внешний сервис не является источником приёмки. `prototypes/coverage-matrix.md` связывает каждый UX-раздел, состояние, роль, route/anchor и evidence; результаты поручений лежат в `prototypes/evidence/1.6a/`–`1.6g/`.

| ID | Design acceptance | Owner / evidence |
|---|---|---|
| DA-01 | UX-01–03: интерактивные personal/team shell, create/switch/invite и профиль различают anonymous/invited/MEMBER/ADMIN/OWNER и loading/empty/error/revoked/success без side effect переходов | Designer 1.6a; prototype routes, coverage rows, screenshots/geometry/keyboard report |
| DA-02 | UX-04–07: структура, библиотека/наборы, список и подготовка показывают scope/права, conflict/archive/programme placeholders и сохраняют ввод при 409/уходе | Designer 1.6b; form-state coverage, screenshots/geometry/keyboard report |
| DA-03 | UX-08: Focus/Work/Overview по фактическим W/H, room surfaces/reconnect/revoke, сохранность draft/selection/scroll/session через 20 switches/resize; локальный выбор не публикует шаг, а отдельное «Переключить» доступно room OWNER и INTERVIEWER и отсутствует у кандидата | Designer 1.6c; room-state/role coverage, desktop/tablet bounding rectangles и focus trace |
| DA-04 | UX-09/11: candidates/result/export и derived processes не раскрывают чужие candidate/count/roomId/time, совпадают по scope/filter и очищаются при revoke | Designer 1.6d; privacy-field coverage, screenshots/geometry/keyboard report |
| DA-05 | UX-12: NONE/draft/published/archive/restore/discard, inheritance/update, mandatory/extras и future-only version semantics различимы без free fallback | Designer 1.6e; programme-state coverage, screenshots/geometry/keyboard report |
| DA-06 | UX-13: target/review/collisions/two approvals/blockers/commit/result показывают одну revision, не раскрывают комнаты и не выдают error/busy за success | Designer 1.6f; complete merge flow, screenshots/geometry/keyboard report |
| DA-07 | Независимый UX review подтверждает DA-01–06, UX-10 и согласованный step-authority checklist: явная публикация доступна room OWNER и INTERVIEWER, но не кандидату. Активная матрица desktop/tablet подтверждает сохранение контекста, отсутствие общего horizontal overflow, keyboard-only navigation, видимый focus и targets ≥44×44 CSS px | UX Critic 1.6g; review, machine-readable summary и desktop/tablet screenshots |

DA-01–DA-06 используют активную матрицу UX-10 для desktop/tablet: 1440×900, 1366×768, 1280×720, 1024×600/480, 1024×768 и 768×1024; zoom 100/125/150/200%, длинный русский текст, keyboard-only navigation, видимый focus, accessible names, доступное последнее поле/primary action, отсутствие общего horizontal overflow и targets ≥44×44 px. Размеры меньше 768 CSS px, phone/mobile browser и экранная клавиатура не входят в release support этого change.

1.6a–1.6g являются design-only и не меняют исполняемое поведение приложения, поэтому behavioural RED для них неприменим. Их geometry/visual checks подтверждают прототип, но не заменяют acceptance приложения: production остаётся заблокирован соответствующим заранее написанным и запущенным RED из разделов 2–22 `tasks.md`.

## Сквозные проверочные сценарии

Пути указаны относительно репозитория. Каждый файл может содержать несколько именованных тестов; исполняемая задача ссылается на нужный сценарий AC, а не обязана одновременно реализовать весь файл.

| ID | Сценарий и наблюдаемый результат | Уровень и будущий файл | Требования |
|---|---|---|---|
| AC-01 | Существующий пользователь открывает единые «Интервью», создаёт комнату из списка; профиль отдельно; компактная форма создания проходит UX-08/10; старые ссылки, личные кандидатские участия, пресеты и служебные разделы по правам сохранены; новая оболочка сохраняет графитово-серую палитру, прежние синие акценты и бирюзовый owner role-color без золотой identity-темы | E2E `frontend/tests/e2e/teams/e2e-workspace-navigation.mjs` | `workspace-navigation`, UX-01/03/06 |
| AC-02 | Вера создаёт/выбирает Atlas и Orbit под одним аккаунтом; ни строки, ни фильтры, ни поздний ответ Atlas не попадают в Orbit | E2E `.../e2e-team-workspaces.mjs` | `team-workspaces` |
| AC-03 | Команда переименовывается по правам без смены ID/назначений; одноразовое приглашение переживает вход/регистрацию; явное принятие добавляет сотрудника один раз; чужое, истёкшее и отозванное принятие не даёт доступа; роли owner/admin/member ограничены | E2E `.../e2e-team-membership.mjs` | `team-workspaces` |
| AC-04 | Администратор создаёт Frontend и вакансию; интервью без вакансии и без трека допустимы; выбор вакансии другого трека отклоняется; архив не удаляет историю | E2E `.../e2e-team-hiring-structure.mjs` | `team-hiring-structure` |
| AC-05 | Борис публикует копию личной задачи в Atlas; Вера находит её по названию/языку либо общему набору, без фильтра/тега трека и без кода обмена; личный оригинал и Orbit не изменены; неавтору доступна командная копия, но не перезапись | E2E `.../e2e-team-task-library.mjs` | `team-task-library` |
| AC-06 | Два разрешённых редактора конфликтуют по версии; архив/восстановление задачи работают; сохранённый снимок в интервью и код кандидата не меняются после правки библиотеки | E2E `.../e2e-team-task-versions.mjs` | `team-task-library` |
| AC-07 | Борис создаёт интервью с двумя задачами, Верой и двумя нанимающими; Анна с `isHr=false` видит назначение; Максим без назначения не видит запись; потерянный ответ не создаёт дубль; форма и её последнее поле/ошибка/submit доступны с клавиатуры на desktop/tablet и при 200% zoom по UX-08/10 | E2E `.../e2e-team-interview-create.mjs` | `team-interview-workflow` |
| AC-08 | Назначения меняются после создания; интервьюер может назначить нанимающего, но обычного интервьюера добавляет только владелец; снятие hiring сохраняет независимый interviewer, снятие последнего источника закрывает внутренний доступ | E2E `.../e2e-team-interview-assignments.mjs` | `team-interview-workflow`, `hr-room-tracking` |
| AC-09 | Выход/исключение закрывает текущую команду и старые ссылки, повторное вступление не восстанавливает назначения; личное пространство и другая команда сохраняются | E2E `.../e2e-team-membership-revocation.mjs` | `team-workspaces`, `team-interview-workflow` |
| AC-10 | Срочное приостановление владельца сразу закрывает его права и замораживает live-комнату; подходящий уже назначенный преемник принимает передачу и отдельно возобновляет; администратор не получает кандидата; без преемника доступен ограниченный архив | E2E `.../e2e-team-owner-recovery.mjs` | `team-workspaces`, `team-interview-workflow` |
| AC-11 | Режим выбирается по полезной ширине и высоте UX-08 на desktop/tablet: ноутбук 1366×768/1280×720, короткое окно 1024×600 и планшет 768×1024. Многопанельный режим доступен только при достаточных размерах; при resize и 125/150/200% zoom выбранный шаг, заметки, черновик чата и Yjs-состояние не теряются; room OWNER и INTERVIEWER могут явно опубликовать локальный шаг, кандидат не получает публикацию или внутренние панели | E2E `frontend/tests/e2e/interview/e2e-room-context-panels.mjs` | `room-context-panels`, `independent-interviewer-step-navigation`, UX-08 |
| AC-12 | Новые сообщения не срывают чтение истории; бейдж сбрасывается после прочтения; reconnect догружает без дублей; скрытая история не запускает непрерывный полный опрос; ошибку можно повторить | E2E `frontend/tests/e2e/interview/e2e-room-panel-continuity.mjs` | `room-context-panels`, текущая история активности |
| AC-13 | Анна видит свой список кандидатов Atlas, две одноимённые записи различаются interviewId; все фильтры одинаковы в списке и XLSX; файл содержит все страницы, корректный пустой результат и архив | E2E `frontend/tests/e2e/teams/e2e-team-candidates-export.mjs` | `workspace-navigation`, `hr-room-export` |
| AC-14 | Исправление вердикта сохраняет первое завершение; любое командное интервью архивируется, включая без нанимающего; архив запрещает записи и сохраняет разрешённый результат после рестарта | E2E `.../e2e-team-interview-lifecycle.mjs` | `team-interview-workflow`, `hr-room-tracking` |
| AC-15 | Полная история Atlas: приглашение → трек/вакансия → общая задача/набор → обязательная программа → назначения/производные процессы → совместное интервью → результат/выгрузка → согласованное объединение с Backend; Orbit и личное пространство независимы | E2E `.../e2e-team-journey.mjs` | Все десять capability, исходные пункты 1–7 и уточнения 1–4 |
| AC-16 | После создания свободного интервью manager меняет имя/время/допустимый непрограммный контекст и добавляет версионную задачу; у программного интервью контекст и основа защищены; stale revision не затирает чужую правку, код и опубликованный шаг сохраняются, frozen/archive запрещают изменение | E2E `.../e2e-team-interview-preparation.mjs` | `team-interview-workflow`, `team-task-library` |
| AC-17 | Сотрудник создаёт общий набор из версий задач, коллега применяет его; edit/copy/archive/restore не меняют опубликованные программы; компактная форма по UX-08/10; отсутствуют task track поля/фильтры; личные пресеты сохранены | E2E `.../e2e-team-presets.mjs` | `team-task-library` |
| AC-18 | Управляющий публикует основу трека из набора/задач и программу вакансии с дополнениями; дубль задачи блокирует публикацию; обновление трека предлагает явно перепубликовать вакансию; архив исходника не меняет снимки стандарта; restore и удаление первоначальной draft-only настройки дают явный выход из блокировки; компактный конструктор по UX-08/10 | E2E `.../e2e-interview-programmes.mjs` | `team-interview-programmes` |
| AC-19 | Процесс автоматически выбирает обязательную программу: foundation нельзя удалить/переписать/переупорядочить или обойти сменой контекста; extras и код решения редактируемы; новая версия влияет только на новые интервью | E2E `.../e2e-programme-interview-integrity.mjs` | `team-interview-programmes`, `team-interview-workflow` |
| AC-20 | У каждого активного сотрудника видны производные пары трек/вакансия без candidate/count/roomId; grant/context/archive изменения обновляют теги; переход показывает только интервью текущего пользователя, включая пустой результат | E2E `.../e2e-member-interview-processes.mjs` | `team-hiring-structure`, `workspace-navigation` |
| AC-21 | Два владельца рассматривают объединение, явно решают роли и коллизии, подтверждают один план; неизвестный target, отозванный владелец, stale approval и конфликт членства не проходят; чужие кандидаты не раскрываются; компактный мастер по UX-08/10 | E2E `.../e2e-team-merge-review.mjs` | `team-merging` |
| AC-22 | Объединение даёт одну команду без дубликата сотрудника, сохраняя IDs/ссылки/снимки/действующие назначения; активные сессии/recovery блокируют commit; после сбоя нет половины переноса; revoked grants не оживают; source redirect проверяет новый доступ | E2E `.../e2e-team-merge-commit.mjs` | `team-merging`, все зависимые capability |

В таблице `.../` означает `frontend/tests/e2e/teams/`. Проверка 200% zoom и длинных русских имён входит в AC-01/AC-11; не заменяется проверкой только наличия DOM-элементов.

## Интеграционные исключения и отрицательная матрица

Эти проверки дополняют пользовательские E2E. Они выбираются потому, что атомарность, байты ответа, межпоточные гонки и реальные миграции нельзя надёжно доказать одним визуальным сценарием.

| ID | Контракт | Будущий backend test class / причина |
|---|---|---|
| INT-01 | Прямой доступ к чужой команде, комнате, библиотеке, архиву; создание команды использует actor-derived PERSONAL/TEAM_CREATE receipt namespace, NFKC+trim canonical hash и атомарно выдерживает lost response, real-backend restart, 20 concurrent exact-201 repeats без `COMMAND_PENDING`, missing/invalid/reused key, 24-hour terminal receipt и GET command outcome; stored membership role остаётся ADMIN/MEMBER, effective OWNER выводится из `owner_user_id` + ACTIVE membership; feature-off запрещает create, но сохраняет безопасные TEAM reads/guards; все защищённые ответы `no-store`; team-admin и isHr не обходят назначения; каталог не содержит приватного nickname/login, email или token; legacy personal endpoints исключают team rooms | `TeamAccessIntegrationTest` — real HTTP на PostgreSQL, матрица методов/ролей, pre-team idempotency/restart и inspection REST/SSE payload |
| INT-02 | Принятие/отзыв приглашения, выдача admin, повторы после потери ответа, старое членство и старый токен после повторного вступления; границы preview/accept 30/min/IP и account, create 20/min/team, ответ 429/Retry-After без секрета | `TeamMembershipIntegrationTest` — транзакции и повторные запросы с реальными сессиями |
| INT-03 | Создание всей комнаты либо ничего; stale task revision; членство потеряно между выбором и commit; idempotency с другим payload | `TeamInterviewCreationIntegrationTest` — атомарность и гонки, не подделка UI |
| INT-04 | Раздельные grants, owner precedence, скомпрометированные старые room tokens/roles, suspension во время SSE/POST и одновременного code/briefing save, отложенная запись с прежней epoch, конечное завершение без lock inversion, два согласия на recovery, чужая/отозванная цель, ограниченный blind archive | `TeamRoomPermissionIntegrationTest`, `TeamOwnershipRecoveryIntegrationTest` — авторизация и сериализация |
| INT-05 | Снимки задач, CAS-конфликт, архив/восстановление, ограничения team/track/vacancy, PATCH метаданных/контекста и добавление задач в существующее интервью, сохранность истории/кода | `TeamTaskLibraryIntegrationTest`, `TeamHiringStructureIntegrationTest` — целостность базы и restart |
| INT-06 | OOXML schema, literal strings вместо формул, отсутствие private notes/tokens/сырой активности, все страницы, date midnight/fallback, лимиты, отзыв права до выдачи файла | `TeamWorkbookIntegrationTest` — разбор workbook и управляемая гонка export/revoke |
| INT-07 | Upgrade существующей БД с личными комнатами/пресетами/HR-историей, team_id остаётся NULL, никакой публикации, восстановление из backup и запрет небезопасного rollback | `TeamSchemaMigrationIntegrationTest` — PostgreSQL/Flyway; H2 auto-DDL не доказывает миграцию |
| INT-08 | Versioned preset archive/restore и programme publish/archive/restore с разрешённым discard первоначальной draft-only настройки, pinned snapshots, stale preset/task source без автоподмены, source archive, base/vacancy revision race, duplicate IDs, protected scaffold через все новые/legacy task/relay/import/reorder/language paths при редактируемом решении | `TeamPresetIntegrationTest`, `InterviewProgrammeIntegrationTest`, `ProgrammeRoomIntegrityIntegrationTest` — целостность и обход UI |
| INT-09 | Производные process pairs по current-epoch grants; dedupe OWNER/INTERVIEWER/HIRING, nonarchived finished/frozen, revoke/archive/merge invalidation; отсутствие чувствительных деталей и candidate-data запроса по другому userId | `TeamMemberProcessProjectionIntegrationTest` — ограниченная серверная проекция |
| INT-10 | Dual-owner approval/digest, owner/state/revision changes, ordered two-team fences, joins/exports/background writes racing commit, bounded expiry закрытой сессии и drain ACKed save до merge/restart, composite FK remapping, active/inactive collisions, rollback и retry; closed source и old tokens не обходят target auth | `TeamMergePlanIntegrationTest`, `TeamMergeCommitIntegrationTest`, `TeamMergeConcurrencyIntegrationTest` — PostgreSQL-транзакция и контролируемые гонки |

AC-04 делится на AC-04a (справочник, create/rename/archive/restore — раздел 6 плана) и AC-04b (создание интервью без вакансии/трека и выбор архивного/чужого значения — после раздела 9). AC-06 аналогично проверяет библиотечные конфликты в разделе 8 и пользовательский снимок в комнате после раздела 9.

AC-02 имеет явный staged gate. Задача 3.2 делает GREEN только backend/API subset AC-02 вместе с INT-01/07: schema, create/read/outcome, idempotency, restart, privacy и scope isolation. Browser AC-02 после 3.2 остаётся валидно RED только по отсутствующим switch/create UI и frontend cache/generation isolation. Задача 3.3 добавляет этот UI и обязана сделать полный browser AC-02 GREEN; backend-only GREEN в 3.2 не считается полной пользовательской приёмкой AC-02.

AC-05 проверяет задачу в разделе 7, а выбор через общий набор — после раздела 17. AC-17a (наборы, порядок, версии, restore и компактная форма) выполняется в разделе 17 после создания свободных интервью в разделе 9; AC-17b (сохранность опубликованной программы) — после 19. AC-16 сначала проверяет свободный контекст в разделе 9, а запреты программного контекста — после 19. INT-08 разделяется на preset, programme publish, resolution/pin и all-entry-point integrity подслучаи по разделам 17–19.

Подслучаи AC-01/07/17a/18/21 пишутся до соответствующего frontend-кода для активной desktop/tablet матрицы: минимальный базовый viewport 768×1024, окна 1024×600/768 и ноутбуки 1280×720/1366×768, включая 200% zoom и длинные русские названия. Измеряются доступность последнего поля, ошибки, primary action и навигации мастера, отсутствие общего горизонтального скролла и перекрытия sticky footer; конкретные минимумы заданы в UX-08/10. Их RED/GREEN относится к фазе соответствующей формы, не откладывается до финального AC-15.

Матрица INT-01/04 перебирает активного/удалённого/приостановленного сотрудника, владельца команды без room assignment, владельца комнаты, интервьюера, hiring-only, совмещённые назначения, кандидата с аккаунтом/без него, состояние active/frozen/archived, новый и старый credential. Для INT-04 управляемые барьеры запускают конкуренцию live runtime handler, фонового persistence и suspension: обе команды завершаются за установленный timeout, а после точки отзыва не допускаются новая запись и доставка под старой epoch. Проверка не сводится к нескольким случайным повторам без контролируемого порядка.

AC-11 проверяет измеренные bounding boxes и доступность основных действий при каждом поддерживаемом desktop/tablet режиме, а не только видимость DOM. Проверяются 768×1024, 1024×600/768, 1280×720, 1366×768 и 1440×900 при 100/125/150/200% zoom: composer/send и навигация доступны, общий horizontal overflow отсутствует, а local step/selection/scroll/drafts и единственный mounted editor/Yjs session сохраняются при resize и смене режима.

В каждый отрицательный ответ включается проверка отсутствия чувствительных полей, а не только HTTP-кода.

## Команды, среда и запись результата

Новые frontend-тесты используют `node:test` и существующий Playwright. Пример будущего запуска из корня:

```sh
E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api node --test frontend/tests/e2e/teams/e2e-team-interview-create.mjs
mvn -f backend/pom.xml -Dtest=TeamInterviewCreationIntegrationTest test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Пути/классы тестов — обязательные контракты реализации; команды запускаются по мере выполнения соответствующих RED/GREEN-задач. Адреса берутся из поднятой тестовой среды и не направляются на production. Для PostgreSQL-проверки используется изолированная база с Flyway; текущий локальный H2-профиль с auto-DDL недостаточен.

Каждая запись в `implementation-verification.md` содержит AC/INT-ID, commit/рабочее состояние, тестовую среду, команду, ожидаемый результат, первоначальный RED с причиной, затем GREEN и артефакт подтверждения. Падение из-за отсутствия браузера/сервера/зависимости не засчитывается как RED поведения.

Существующие регрессии выбираются по затронутой области: `e2e:dashboard`, `e2e:hr-cabinet`, `e2e:roles`, `e2e:account-binding`, `e2e:account-switch`, `e2e:step-publication`, `e2e:private-notes`, `e2e:sse-reconnect`, `e2e:manager-workspace-integrity`, `e2e:multi-activity`, `e2e:activity-timeline`. Изменения ожидаемых текстов/маршрутов не должны ослаблять проверки доступа, приватности, сохранности кода и истории.

## Граница приёмки

Документальный gate принят по согласованности, полноте и strict OpenSpec validation. Приёмка реализации остаётся открытой до AC/INT, профильных регрессий, независимого ревью решения/безопасности, QA, review тестов и продуктовой приёмки. Согласование документов или запуск разработки не считаются GREEN.
