# Полная проверка проекта — 04.10.2026

Запрос: повторить все имеющиеся тесты и проверки текущего проекта, включая UI,
найти и исправить отказы. Результаты этого запуска отделены от прежних PASS.
Статус: полный прогон завершён, найденные дефекты исправлены. Актуальные
результаты всех 102 browser файлов успешны: 100 неизменённых файлов из полного
прогона и два целых повторных файла после исправления только тестовых ожиданий.
Это реестр последних результатов по файлам, а не один полный зелёный запуск.
Отдельный целый workspace-navigation файл с выключенными командами также
успешен. Доступные локальные проверки завершены; границы окружения указаны ниже.

## Уже подтверждённые проверки

| Проверка | Фактический результат | Доказательства |
| --- | --- | --- |
| Backend clean verify | 401/401, 61 класс; 0 failure/error/skip | [summary](../../.run/oct04-full-project-verification/backend/summary.json), [полнота XML](../../.run/oct04-full-project-verification/backend/inventory-audit.json) |
| Production JAR без test classpath | Health 200, Hibernate validate, PostgreSQL fresh Flyway V1–V33 | [packaged runtime](../../.run/oct04-full-project-verification/backend/packaged-runtime-summary.json) |
| Frontend unit/contract после окончательного исправления шрифтов | 91/91, 20 файлов; 0 failure/skip | [журнал](../../.run/oct04-full-project-verification/font-final/frontend-unit-contract.log) |
| TypeScript и production build | PASS; 146 исходных файлов, включая 23 новых font resources; два предупреждения о размере assets | [typecheck](../../.run/oct04-full-project-verification/font-final/frontend-typecheck.log), [build](../../.run/oct04-full-project-verification/font-final/production-build.json) |
| Последний полный последовательный browser прогон | Все 102 файла выполнены: 100 PASS / 2 FAIL; 490 Node сценариев = 487 PASS / 2 FAIL / 1 conditional Native AX skip. Два отказа оказались тестовыми ожиданиями; исходный результат сохранён | [raw summary](../../.run/oct04-full-project-verification/font-final/ui-summary.json), [независимый raw аудит](../../.run/oct04-full-project-verification/audit/raw-font-final-attempt-01-audit.json) |
| Актуальный результат по каждому browser файлу | 102 успешных файла: 100 из полного прогона + два целых повторных файла; 48 Node файлов: 489 PASS / 1 conditional Native AX skip / 0 FAIL / 0 cancelled; 54 CLI файла PASS | [отдельный независимый реестр](../../.run/oct04-full-project-verification/audit/latest-per-file-ledger-audit.json) |
| Frontend с выключенной функцией команд | Целый workspace-navigation: 106 PASS / 3 intentional team-only skip / 0 FAIL / 0 cancelled; настоящая сборка флага false, неизменённый файл | [OFF runtime](../../.run/oct04-full-project-verification/default-off/runtime-off-attempt-01/result.json) |
| npm audit full/production и установленное дерево | 0 advisories; npm ls без problems | [full audit](../../.run/oct04-full-project-verification/integration/npm-audit-full.json), [production audit](../../.run/oct04-full-project-verification/integration/npm-audit-production.json), [installed tree](../../.run/oct04-full-project-verification/integration/npm-installed-tree.json) |
| Корневые Node script tests | 31/31, включая 10 новых Doctor сценариев | [Doctor verification](../../.run/oct04-full-project-verification/doctor/verification-summary.json) |
| Native AX Node contracts | 14/14 | [supplementary summary](../../.run/oct04-full-project-verification/supplementary/supplementary-summary.json) |
| Swift unit/state/policy | 14/14 XCTest; все targets собираются | [supplementary summary](../../.run/oct04-full-project-verification/supplementary/supplementary-summary.json) |
| Script syntax и конфигурации | 13/13 Node/shell syntax, 6 shell syntax + 4 Compose parse — PASS | [final syntax](../../.run/oct04-full-project-verification/final/script-syntax-checks.json), [final configuration](../../.run/oct04-full-project-verification/final/configuration-checks.json) |
| Новый dev-server: HTTP/API/SSE/HMR | 11/11; 18 GET/HEAD вариантов служебных action paths запрещены | [независимый обзор](../../.run/oct04-full-project-verification/dependencies/security-review.json) |
| Видимый браузер: возвращение фокуса и обновление команды | 2/2 расширенных сценария; trusted blur/focus и team GET | [окончательная версия](../../.run/oct04-full-project-verification/headed-focus-diagnosis/fully-fixed-variant-summary.json) |
| Основной пользовательский адрес: landing/login | PASS, 19 GET, 0 page errors; без отправки форм и записи в пользовательскую БД | [read-only smoke](../../.run/oct04-full-project-verification/audit/main-readonly-ui-smoke.json) |
| Локальный проект после проверок | Frontend, публичный API health и локальный font stylesheet — HTTP 200; основной frontend/backend работают | [окончательный health](../../.run/oct04-full-project-verification/final/main-health.json) |
| Независимая сверка исходников и зависимостей | Build 146 и backend 275 файлов не изменены; все 292 текущих frontend файла совпадают с candidate. После полного прогона изменены только два проверенных тестовых helper. Все 102 актуальных log SHA и 36 установленных direct versions проверены | [актуальный реестр](../../.run/oct04-full-project-verification/audit/latest-per-file-ledger-audit.json), [source review](../../.run/oct04-full-project-verification/audit/menu-result-independent-review.json) |
| Новые font assets и production CSS | 39 исходных face declarations, 21 WOFF2, все weights/unicode subsets сохранены; production CSS семантически идентичен после minification, WOFF2/OFL побайтно совпадают | [proposal APPROVE](../../.run/oct04-full-project-verification/audit/font-self-host-proposal-review.json), [production CSS APPROVE](../../.run/oct04-full-project-verification/audit/production-font-css-independent-review.json) |
| Проверка запуска со шрифтами | Branding 4/4, business 13/13, два дополнительных целевых повтора PASS; fonts failure оставляет UI доступным | [runtime APPROVE](../../.run/oct04-full-project-verification/audit/font-startup-runtime-independent-review.json), [RED/GREEN и хеши](../../.run/oct04-full-project-verification/fixture-cleanup/font-startup-final/result.json) |
| Два последних тестовых ожидания | Invitation: 14 PASS / 1 conditional AX skip; hiring: 6/6 PASS; ещё два целевых повтора PASS. Все 222 исходные assertions и timeouts сохранены | [независимый APPROVE](../../.run/oct04-full-project-verification/audit/menu-result-independent-review.json), [whole-file RED/GREEN](../../.run/oct04-full-project-verification/fixture-cleanup/menu-result-diagnostics/result.json) |

Backend выполнялся в отдельной копии с чистой компиляцией и отдельным JVM на
тестовый класс. PostgreSQL fixtures используют PostgreSQL 16.13; существующие
unit и legacy H2 fixtures сохраняют свою конфигурацию. Это не заявление, что
каждый из 401 тестов использует PostgreSQL. Собственный временный DB удалён.

Дополнительно просмотрены снимки окончательного UI: команды заметок на ширине
390 px, раскрытый селектор режима и условие в тёмной теме, завершение интервью
в светлой теме. Геометрия, взаимодействия, светлая/тёмная тема и адаптивные
состояния проверяются соответствующими E2E; просмотр этих снимков не объявляется
ручной проверкой каждого экрана или каждой возможной ширины.

## Найденные отказы и исправления

- **Doctor:** защищённый endpoint вызывался без авторизации. Теперь токен
  передаётся явно через environment и stdin заголовка, без URL/argv/log;
  отсутствующий токен, HTTP/JSON ошибки и неверный status не выдают PASS.
  RED сохранён, 10/10 контрактов и реальный authenticated HTTP проверены.
  [Независимый обзор — APPROVE](../../.run/oct04-full-project-verification/doctor/security-review.json).
- **UI modal helper:** проверка высоты кнопки измеряла промежуточный кадр
  анимации Ant Design. Исправлено ожидание rc-motion и стабильной геометрии;
  размер/assertions не ослаблены. Целый файл после исправления — 23/23.
  [RED/GREEN и 12 реальных открытий](../../.run/oct04-full-project-verification/modal-readiness/verification-summary.json).
- **Headed focus helper:** Playwright включал focus emulation даже в видимом
  браузере. Только для headed-проверки отключена эта эмуляция публичным CDP API;
  события не синтезируются. Исправлена обработка ожидающих promises, чтобы
  отрицательный контроль не создавал unhandled rejection после теста.
  Два расширенных сценария подтвердили настоящие trusted blur → focus и fresh
  team GET во всех предусмотренных actor/viewport ячейках.
  [Первичные отказы и проверки](../../.run/oct04-full-project-verification/headed-focus-diagnosis/verification-summary.json).
- **Зависимости frontend:** исходный npm audit сообщил 28 advisories, включая
  2 critical и 13 high. Проверенный candidate обновляет DOMPurify, Router и
  согласованную пару Rspack; остальные direct versions сохранены. npm audit
  full/production сообщает 0. Неиспользуемые опасные HTTP actions dev-сервера
  удалены и защищены guard; CORP установлен; API/SSE/HMR сохранены.
  [Patch, исходные отказы, версии и reachability](../../.run/oct04-full-project-verification/dependencies/dependency-remediation-result.json).
- **Регрессия перехода после logout при Router 7:** deferred navigation
  позволяла защитному redirect заменить явный `/` на `/login`. Использован
  поддерживаемый `BrowserRouter useTransitions={false}`, сохраняющий прежнюю
  семантику навигации; обработчики авторизации и их проверки не ослаблены.
  Первичные account-switch и HR export отказы сохранены.
  [Независимый обзор — APPROVE](../../.run/oct04-full-project-verification/dependencies/security-review-navigation.json).
- **Подсказка состава комнаты с клавиатуры:** прежняя проверка после hover
  могла считать оставшуюся подсказку результатом focus. Новый сценарий убирает
  курсор, ждёт скрытия и переходит настоящим Tab. Он воспроизвёл дефект:
  подсказка не открывалась с клавиатуры. Добавлен focus trigger; целый сценарий
  с 10 участниками, 2100 сохранёнными событиями, reload/export и проверкой прав
  прошёл. [RED/GREEN](../../.run/oct04-full-project-verification/activity-tooltip/verification-summary.json).
- **Приватные query параметры в журналах dev-сервера:** реальные HTTP проверки
  обнаружили, что диагностика первичной компиляции, ошибки пути и proxy ошибки
  могла записывать URL с private query. Отключена инфраструктурная запись URL;
  ошибки сборки остаются видимыми. Новый постоянный контракт — 6/6; production
  bundle до и после изменения логирования идентичен. Старый локальный журнал
  защищён правами 0600 и очищен от API query значений без сырой резервной копии.
  [Независимая реальная HTTP проверка — APPROVE](../../.run/oct04-full-project-verification/dependencies/logging-privacy/security-review.json).
- **Список командной библиотеки после повторного сохранения:** управляемый
  порядок ответов подтвердил реальный дефект: PATCH сохраняет новое название
  и revision на сервере, но запоздавший GET оставляет старое название в UI.
  Черновик и серверные данные не теряются. На установленном RTK отдельно
  воспроизведено, что дублирующий ручной refetch после мутации теряет ожидаемое
  обновление списка. Существующая E2E усилена последовательностью
  409 → удержанный старый GET → PATCH 200 → отпускание GET → свежий список и
  reload; первичные RED задач и наборов сохранены. Удалены 9 дублирующих
  post-mutation refetch в командной библиотеке; ручное обновление, права и CAS
  сохранены. Тот же whole E2E подтвердил fresh GET, UI, reload и состав/порядок
  набора. [Независимый обзор — APPROVE](../../.run/oct04-full-project-verification/audit/library-cache-fix-independent-review.json),
  [RED/GREEN manifest](../../.run/oct04-full-project-verification/final/ui2-team-diagnostics/fix-result.json).
- **Освобождение UI fixtures при ошибке подготовки:** в двух файлах ошибка
  goto возникала до caller try/finally, оставляя Chromium открытым; третий
  удерживал context до общего teardown. Добавлен cleanup с повторным выбросом
  исходной ошибки. Контролируемые 8 failure probes: RED 0/8, GREEN 8/8.
  Это проверки очистки при намеренной ошибке, а не успешные продуктовые сценарии;
  исходные assertions и timeouts сохранены.
- **Готовность UI вместо ожидания всех сетевых запросов:** navigation trace
  подтвердил, что проверка уведомлений ждала только два внешних font запроса,
  когда DOM и нужный интерфейс уже были готовы. Fixture ждёт DOMContentLoaded и
  явную готовность своего экрана, сохраняя timeout и все AC18 assertions.
  Два целых повтора уведомлений по 16/16 прошли. В roster/business исходное
  ожидание отдельно воспроизведено при удержанных шрифтах: UI готов примерно
  за секунду, goto истекает через прежние 6/5 секунд, других pending запросов
  нет. После такой же правки whole 14/14 и 13/13 прошли; все 27 UI-ready событий
  наблюдались с двумя pending font запросами. Исходные тестовые assertions,
  timeout и пользовательские действия сохранены. Эта правка тестовых ожиданий
  не меняла приложение; последующее самостоятельное исправление источника
  шрифтов описано ниже.
  [Controlled RED/GREEN](../../.run/oct04-full-project-verification/fixture-cleanup/held-font-readiness/result.json).
- **Измерение footer во время открытия диалога:** controlled RED воспроизвёл
  сдвиг примерно 40px при реальном `antZoomIn`: scale изменялся, внутренние
  offsets/размеры footer и fields оставались одинаковыми. Добавлено ожидание
  завершения motion и стабильного rect перед измерением; исходные 39 assertions,
  допуск <2px и deadline 5000ms сохранены. Whole business 13/13 и отдельный
  geometry repeat подтвердили delta 0. Первичный whole 11/13 с двумя другими
  timeout setup сохранён и привёл к следующему расследованию.
  [Независимый обзор — APPROVE](../../.run/oct04-full-project-verification/audit/business-modal-independent-review.json).
- **Внешний font stylesheet блокировал запуск приложения:** в фактической
  трассе Google CSS отвечал за 3,6–4,6s, после него наступал DOMContentLoaded.
  Controlled удержание этого запроса воспроизвело timeout 5s в business и 30s
  на главной: локальные ресурсы уже завершились, но React UI и DCL/load отсутствовали,
  единственным pending ресурсом был внешний stylesheet. Конкретная причина
  прежних нетрассированных timeout остаётся выводом, а сама блокирующая
  зависимость доказана. Новый постоянный browser regression сначала FAIL на
  прежнем приложении, затем PASS на тех же байтах теста после исправления.
  IBM Plex сохранён локально: 21 WOFF2, 39 font-face declarations, OFL;
  заменены только source URLs и первый import global.css, без entry/config/package
  изменений. Все исходные subsets и начертания сохранены; исходный Google
  response не имел отдельного Sans 800, прежний nearest-700 mapping сохранён.
  Public/login/register работают без внешних font requests. При намеренном отказе
  локальных WOFF2 fallback оставляет UI готовым, без page errors. Production
  assets и CSS после minification проверены отдельно. Все 102 browser файла
  после этого изменения приложения выполнены; branding и business прошли.
  [Исходники/лицензия и реализация](../../.run/oct04-full-project-verification/font-self-host/application.json),
  [runtime RED/GREEN](../../.run/oct04-full-project-verification/fixture-cleanup/font-startup-final/result.json).
- **Закрывающееся меню и открывающийся диалог в тестах:** два оставшихся
  controlled RED подтвердили ошибки ожидания, не приложения. После modified
  click меню уже имело `aria-expanded=false` и `inert=true`, но `isVisible()`
  оставался true во время 160ms анимации закрытия. Тест теперь проверяет
  логическое закрытие, заново открывает меню и выполняет прежний обычный клик.
  В диалоге результата измерялся `antZoomIn`: визуальный gap 0,8px при scale 0,2,
  хотя CSS и offsets давали правильные 4px. Helper ждёт окончания motion и
  стабильной геометрии; GREEN gap 4px. Сохранены все 222 исходные assertion
  вызова, регистрации сценариев и прежние timeout 6000ms. Целые файлы:
  invitation 14 PASS / 1 conditional AX skip, hiring 6 PASS; два отдельных
  повторения PASS. Изменены только два E2E файла; все 146 production файлов
  совпадают с полной проверкой и сборкой.
  [Независимый APPROVE 36/36](../../.run/oct04-full-project-verification/audit/menu-result-independent-review.json).

Первый полный browser запуск на исходных зависимостях: 102 файла выполнены,
101 PASS / 1 FAIL; 487 Node сценариев PASS, 1 FAIL, 1 conditional Native AX skip.
Это исходный результат, а не итоговый зелёный прогон.
[Первичный реестр](../../.run/oct04-full-project-verification/ui-summary.json).

Попытка проверки candidate на порту 18173 прервана: этот origin отсутствует в
CORS whitelist замороженного диагностического API. Login 403 был ошибкой
настройки тестового запуска, не дефектом приложения. Повтор на разрешённом
диагностическом адресе 15173 обнаружил logout regression; partial журналы также
сохранены. После фиксации Router следующий полный запуск выполнил все 102 файла:
101 PASS / 1 FAIL; единственный отказ был в клавиатурной подсказке. Эти журналы
сохранены отдельно от финального повторного запуска.
[Промежуточный полный прогон](../../.run/oct04-full-project-verification/final-browser-complete/ui-summary.json).

Следующий полный запуск на исправленных production исходниках: все 102 файла
выполнены, 97 PASS / 5 FAIL. Четыре файла имели timeout подготовки страницы;
два из них дополнительно оставляли Chromium открытым и достигли process timeout.
Пятый не подтвердил новый title после повторного сохранения задачи. Общие Node
счётчики этого запуска неполны из-за отсутствующих footer двух зависших файлов;
они не выдаются за полный результат всех сценариев. Все 269 frontend хешей
совпали до и после запуска. Отказы и журналы сохраняются для отдельного разбора.
[Raw 102](../../.run/oct04-full-project-verification/final/ui-summary.json),
[post-run source pairing](../../.run/oct04-full-project-verification/final/post-suite-source-verification.json).

Предыдущий последовательный запуск выполнил все 102 файла до переноса
шрифтов: 100 PASS / 2 FAIL. Независимый аудит подтвердил 48 полных
Node footer и 54 CLI файла, 489 = 486 PASS / 2 FAIL / 1 skip, отсутствие
пропусков/дублей и совпадение всех log SHA. Все 269 frontend файлов остались
одинаковыми в repository и candidate на протяжении прогона. Два отказа:
измерение footer командного интервью и timeout `load` главной страницы в
проверке бренда. Разбор и последующие повторы сохраняются отдельно; этот
исходный результат не переименовывается в «102/102 PASS».
[Последовательный raw прогон](../../.run/oct04-full-project-verification/confirmed/ui-summary.json).

После исправления font stylesheet зафиксированы новые 292 frontend файла и
146 production исходных/статических файлов. Отличия от предыдущего снимка:
global.css, helper геометрии business, один новый branding regression и 23 font
resources. Проверки 91/91, types и build выполнены на этом снимке. Новый полный
browser запуск выполнил все 102 файла: 100 PASS / 2 FAIL, 48 полных Node footer,
490 = 487 PASS / 2 FAIL / 1 conditional AX skip и 54 CLI файла. Все 292 хеша
совпали до и после запуска; все log SHA проверены независимо. Отказы меню и
диалога результата разобраны описанными выше controlled traces. Raw summary
остаётся 100/2. Только после test-only исправлений повторены оба целых файла.
Независимый актуальный реестр объединяет 100 неизменённых успешных результатов
с этими двумя повторными результатами: 489 PASS / 1 skip / 0 FAIL, без дублей
и пропусков файлов. Дополнительные focused repeats в этот счёт не добавляются.
Production исходники не менялись после полной проверки, поэтому повтор всех
остальных файлов и сборки не требовался.
[Source freeze](../../.run/oct04-full-project-verification/font-final/source-freeze-summary.json),
[immutable raw аудит](../../.run/oct04-full-project-verification/audit/raw-font-final-attempt-01-audit.json),
[актуальный реестр по файлам](../../.run/oct04-full-project-verification/audit/latest-per-file-ledger-audit.json).

Дополнительный запуск использовал настоящий frontend build-time флаг
`FEATURE_TEAM_WORKSPACES=false` и `E2E_EXPECT_TEAM_WORKSPACES=false` на
отдельном порту 15173. Проверен весь неизменённый workspace-navigation файл:
109 сценариев, 106 PASS / 3 intentional team-only skip / 0 FAIL / 0 cancelled.
В compiled main.js подтверждён false; диагностический backend 18080 оставался
с включённой функцией. Три team-only сценария не обращались к её API, а
личная навигация, поиск, selector и overflow проверены в OFF-ветках. Backend
feature-off/default контракты отдельно входят в 401 backend тест. OFF счётчики
не добавляются к 490 enabled сценариям: это повтор одного файла в другой
конфигурации, не дополнительные уникальные тесты. Все 292 root/candidate/OFF
хеша совпали; собственные браузеры и OFF frontend закрыты, listener 15173
отсутствует. Основной frontend 5173 и оба API процесса сохранены.
[OFF результат и cleanup](../../.run/oct04-full-project-verification/default-off/runtime-off-attempt-01/result.json).

Основной frontend 5173 перезапущен для применения проверенных зависимостей и
защиты журнала, в рамках ранее данного пользователем указания перезапустить
локальный проект. Backend 8080 и пользовательская БД не перезапускались и не
изменялись тестовыми сценариями. Для записывающих UI/API тестов использовались
отдельный frontend 15173, диагностический API 18080 и синтетические данные.

## Границы результата

Полнота означает все найденные исполнимые suites текущего репозитория, а не
доказательство отсутствия любых возможных ошибок. npm audit 0 относится к
доступной metadata установленного lock: bundled shell-quote/braces остаются
в dev-server, но проверенный call graph не даёт untrusted HTTP input достичь
их опасных парсеров. Они не объявлены удалёнными или patched.

Native AX контрактные тесты и Swift unit tests не заменяют системную проверку
macOS Accessibility. Conditional Native AX требует отдельного ручного
протокола; один такой conditional сценарий имеет явный SKIP.
Trusted document blur/focus не равнозначен hidden visibility. Две ограниченные
проверки с настоящим сворачиванием окна и отключённой focus emulation оставили
`document.visibilityState=visible`, поэтому реальный hidden lifecycle остаётся
UNVERIFIED/ENVIRONMENT_UNAVAILABLE, без подмены события или свойства.
[Результат окружения](../../.run/oct04-full-project-verification/visibility-sync/verification-summary.json).
Production multi-process realtime topology и мобильные браузеры находятся
вне локальной матрицы. Docker Compose разобран, но образы не собирались.

В репозитории не настроены отдельные lint/format/mutation gates: их успешный
запуск не заявляется. Сборка сохраняет два предупреждения о размере assets.
Частичная UI.1 приёмка и production topology остаются отдельными пунктами P6.
