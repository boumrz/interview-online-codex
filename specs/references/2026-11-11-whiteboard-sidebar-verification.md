# Доска, левая панель и движение draw.io: проверка

Дата: 11 ноября 2026. Контракты: [P2.5](../features/p2-5-room-whiteboard.md),
[P0.3](../features/p0-3-room-panels.md), [P2.4](../features/p2-4-room-diagrams.md).
Результат: реализовано и технически проверено. Продуктовая приёмка ожидается.
Default flags схемы и доски остаются `false`; локальная preview-конфигурация
включает оба режима в рамках ранее запрошенного пользователем запуска.

## Что изменилось

- В draw.io через поддерживаемый `customCss` отключены native transitions,
  animations и smooth scrolling. Оболочка меняет геометрию без анимации.
  Отключение не распространяется на закрытие AntD Modal: иначе оставалась
  перехватывающая мышь маска. Vendor draw.io, iframe и история не заменялись.
  Native responsive debounce остаётся, промежуточной анимированной ширины нет.
- Вспомогательная панель слева; её четыре вкладки и сворачивание находятся в
  собственной шапке. Controls36px; закрытый вид — полоса48px с открытием.
  Выбранная вкладка, ширина, черновики, фокус и смонтированные редакторы сохраняются.
  Разделитель растит левую панель движением вправо. Условие управляется отдельно.
- Новый четвёртый режим **«Доска»** на Excalidraw0.18.1 (MIT): свободное перо,
  стирание, текст, базовые фигуры/стрелки, собственный Undo/Redo и экспорт.
  Документ независим от draw.io и задач. Готовый компонент интегрирован с текущими
  Kotlin/PostgreSQL и SSE/POST; новых платформ, paid API или collab-сервисов нет.
- Mouse/touch/pen используют native Pointer Events. Давление и точки штриха
  сохраняются; pen mode не рисует от случайного touch. Программа не обещает
  аппаратное palm rejection, tilt или работу каждой кнопки любого планшета.
- Сервер атомарно объединяет изменённые элементы по версии/nonce, сохраняет
  tombstones и durable receipts, проверяет live authority перед receipt replay,
  публикует SSE после commit. V36 принадлежит комнате и удаляется каскадно.
- Очередь в памяти coalesce по ID; неопределённый POST повторяется с прежним
  operationId/body. Старый capability отличается от реального deny даже до
  обработки SSE error браузером. Reset блокирует поздний native callback старой
  сцены. Remote update исключён из Undo; собственный неизменившийся ACK не
  запускает лишний native update. AppState и данные доски не пишутся в recovery storage.

## Поставка SDK и ограничения

Шрифты и font-subsetting Worker обслуживаются локально. Compatibility adapter
ограничен закреплённым SDK: extensionless roughjs imports, native Worker URL и
native font CDN fallback. Worker ESM-граф из четырёх файлов поставляется без
изменения байтов; URL — HTTP(S) origin приложения, без `file:` машины сборки.
Даже при404 локальных шрифтов внешней попытки нет, рисунок/текст сохраняются.
Восьми семействам соответствуют полные лицензии и SHA-256 всех233 font-файлов;
неиспользуемый server-side Liberation не распространяется браузеру.

Допустимые drawing fontFamily — `{1,2,3,5,6,7,8}`; неподдерживаемые4/9/100
отклоняются атомарно. Пределы: операция512000bytes, сцена2MB,5000элементов с
tombstones,20000точек на штрих и100000на сцену. Файлы/embeds/небезопасные ссылки,
неизвестные поля/типы и нечисловая геометрия не принимаются. Отдельные объекты
редактируются конкурентно; один объект объединяется атомарно по native версии,
а не через независимое слияние каждого свойства.

## Проверки и evidence

Наборы выполнялись целевыми прогонами; числа ниже — уникальные сценарии,
повторные проверки исправлений не суммируются. Это не полный suite проекта.

| Набор | Результат | Покрытие |
| --- | --- | --- |
| PostgreSQL | **53/53 PASS** |22 whiteboard (включая default-off и font boundary) +31 прежних diagram/mode; authority, revoke/lifecycle, CAS/merge/idempotency, pressure, лимиты/cascade |
| Whiteboard protocol/session unit | **25/25 PASS** | Coalescing, immutable retry, ACK/newer local, tombstones, stale body/proof, no sameproof loop, delayed reset, throttle/cleanup, отсутствие render-echo |
| Asset/native motion contracts | **4/4 PASS** |3 pinned Excalidraw assets/worker/fonts+licenses,1 real draw.io motion с четырьмя resize700↔1440 |
| Новая доска, production E2E | **5/5 PASS** | Два автора/Undo, trusted pen pressure, touch, paused text, reconnect/reload/late join, четыре режима, full-window/themes, readonly из Code/Markdown,400reset/eraser, три экспорта, font404 |
| Прежняя комната, production E2E | **39/39 PASS** |3 sidebar +19 context (матрица24 viewport/zoom) +9 condition +8 Code/Markdown |
| Схема, production E2E | **6/6 PASS** | Прежние четыре совместных сценария; два связанных с изменённым Modal/раскладкой повторены отдельно после исправления |
| Dev/StrictMode | **1/1 PASS** | Реальный bootstrap новой доски, текущий режим локальной разработки |
| Дополнительная геометрия | **PASS** |1280×720: скрытие левой панели сохраняет высоту раскрытого условия; Work-бюджет416px учитывает шапку/границы без уменьшения320px содержимого |
| TypeScript, production build off/on, Compose, links/IDs/whitespace | **PASS** | Локальные процессы и отдельные output directories; `.env` пользователя не менялся |

Подтверждены поведенческие RED до реализации sidebar, native motion, whiteboard
API/UI и исправления review-находок. Исправлены обнаруженные реальные проблемы:
React render feedback loop, stale capability до SSE error, reset с поздним
callback, отбрасывание незавершённого пустого текста, маска Modal после слишком
широкого запрета animations, короткое поле заметок, горизонтальный overflow
закрывающейся Tooltip, budget/sidebar borders и file-URL Worker.

Исправлены и ошибки автоматизации: native radio нажимается через видимую label,
жест начинается после закрытия mode Modal и на видимом canvas; разные страницы
одного Chromium рисуют по очереди с удержанными POST, затем запросы отпускаются
конкурентно. Offline-проверка действительно закрывает owned SSE и подтверждает
новое state_sync поколение, а не принимает зелёный ещё живой SSE за reconnect.
Обычный HTTP-only отказ оставляет явный Retry, не теряя pending.

Основные журналы:

- `/tmp/interhub-whiteboard-capability-verified.log` —52 PostgreSQL;
  `/tmp/interhub-whiteboard-font-boundary-green.log` —ещё1целевой PG.
- `/tmp/interhub-whiteboard-session-green.log` —25 unit;
  `/tmp/interhub-canvas-assets-final.log` —4 contracts.
- `/tmp/interhub-whiteboard-qa-final.log` —чистый5/5 production;
  `/tmp/interhub-whiteboard-qa-dev-bootstrap.log` —dev/StrictMode.
- `/tmp/interhub-left-sidebar-budget-final.log` —31sidebar/context/condition;
  `/tmp/interhub-left-sidebar-height-stability-final.log` —дополнительный guard.
- `/tmp/interhub-whiteboard-shared-mode-off-regression.log` —8 Code/Markdown;
  `/tmp/interhub-left-sidebar-full-regression.log` —четыре прежних diagram PASS;
  `/tmp/interhub-drawio-modal-layout-final.log` —два итоговых diagram PASS.

Независимые scoped reviews: **Security PASS / Reliability PASS**, UX — approve.
Проверяющий самостоятельно повторил25 unit и оба race-repro, новые PostgreSQL
проверки,3 asset contracts; проверил текущие PG XML и итоговый native UI журнал.

Физический Wacom/Apple Pencil/Surface Pen не подключался. Trusted pen input и
сохранение давления проверены браузерной автоматизацией; аппаратные ощущения,
кнопки/драйвер и длительный handwriting-сеанс требуют ручного просмотра.
Полная cross-browser/mobile, нагрузочная и многочасовая проверка не проводились.
Межпроцессной realtime-доставки этот выпуск не добавляет: действует текущая
топология комнаты. Production не развёртывался, продуктовая приёмка ожидается.

## Локальный просмотр

Ранее пользователь явно запросил запуск приложения. После проверок обновлены
только принадлежащие этому checkout backend8080/frontend5173, с прежней базой,
ключами и ником/паролем. Social auth остаётся off. Перед V36 сохранена приватная
резервная копия `.run/local-before-whiteboard-20261111.dump`.
Тестовые fixtures выполнялись только на owned scratch schemas/процессах.
Текущий runtime и логи — `.run/whiteboard-local-runtime.json`; секретов в нём нет.
HTTP-проверка подтверждает оба включённых canvas gate, оба флага в реально
обслуживаемом JS, API proxy, local draw.io, оригинальные байты worker-графа,
пустой список social providers и успешную V36. Адрес: `http://localhost:5173`.
