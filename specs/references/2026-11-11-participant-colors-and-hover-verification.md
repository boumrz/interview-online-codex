# Вкладки, цвета участников и наведение пера

Дата: 2026-11-11. Реализовано и технически проверено; продуктовый просмотр
пользователя ожидается. Предыдущая поставка доски описана в
[базовом отчёте](2026-11-11-whiteboard-sidebar-verification.md).

## Результат и покрытие требований

| Контракт | Результат | Проверка |
| --- | --- | --- |
| P0.3 R-02, R-06–R-07 / AC-06–AC-07 | Четыре вкладки возвращены над рабочей областью перед селектором режима. Только панель перенесена влево; вкладка открывает её из свёрнутого состояния. Управление 36px, полоса 48px, ширина/черновики/фокус и высота условия сохранены | 31 production E2E: 3 sidebar, 19 context с 24 viewport/zoom случаями, 9 condition |
| P2.4 R-14 / AC-13; P2.5 R-13 / AC-08 | Уникальный долговременный HEX на логического участника комнаты, одинаковый для доски/схемы и вкладок участника. Отдельная общая легенда доступна кандидату. Старые объекты и ручные цвета сохраняются | 9 PostgreSQL; native production E2E двух авторов; 3 unit стартового адаптера |
| P2.5 R-03, R-14 / AC-09 | Локальный пунктирный указатель реального pen hover; контакт/уход/cancel/blur/tool/readonly/mode скрывают его. Нет элемента документа, сетевой записи или перехвата ввода. Геометрия учитывает zoom/resize/full-window | 3 production pen E2E и целевой RED→GREEN |

Цвет хранится в `room_drawing_colors` (V37) под существующей комнатной
идентичностью участника. PK идентичности, уникальность room/color и блокировка
комнаты сериализуют назначения. Начальная палитра дополняется новыми HEX без
повторов; уход не освобождает резервирование. Запись удаляется вместе с комнатой.
Назначение не является неизменяемой подписью объекта: ручной native выбор остаётся
доступен. Цвет не даёт прав и не заменяет проверку доступа.

Draw.io получает default vertex/edge styles с сохранением native routing.
Изолированный same-origin startup adapter один раз задаёт собственный native
freehand color; vendor не меняется. `noAutoFocus` предотвращает перехват фокуса
скрытым canonical iframe при загрузке принятого документа. Default стили новых
объектов проверены в сохранённом XML и у обоих участников; legacy unstyled
объекты сохраняют native foreground. Доска получает native initial stroke color
до редактирования. Повторный render/remote update не сбрасывает ручной выбор.

## Выполненные проверки

- **31/31 panel E2E** — `/tmp/interhub-sidebar-toolbar-restore-green.log`.
  RED до правки подтверждал неверное расположение вкладок внутри панели.
- **9/9 PostgreSQL** — `/tmp/interhub-drawing-color-final.log`:
  гости и разные аккаунты; 40 одновременных различных участников; восемь вкладок
  одной identity; reconnect/имя/роль; чтение сохранённого назначения без локального
  кеша; room-local mapping; ограничения БД/cascade; features off и rejected admission.
- **3/3 native adapter unit** — `/tmp/interhub-drawing-colors-native-defaults-unit.log`:
  native this/аргументы/результат, однократная настройка, сохранность ручного цвета,
  явный отказ несовместимого startup.
- **1/1 native motion guard** — `/tmp/interhub-drawing-colors-motion.log`.
- **9/9 итоговых production canvas E2E** на окончательных исходниках —
  `/tmp/interhub-colors-hover-final-cohort.log`: 5 прежних whiteboard,
  1 общий native color и 3 pen/hover. Все три файла завершились с exit 0.
  Проверены concurrent strokes/Undo, давление, текст/reconnect/reload,
  четыре режима/темы/full-window/finished, восстановление после постоянного отказа,
  local font failure без CDN, цвета/легенда/manual picker, native draw.io
  фигуры/связи/freehand/legacy стили, hover/no-hover pressure profiles.
- TypeScript, production build, backend package, `git diff --check` — PASS.
- Независимый Security/Reliability review durable mapping — PASS;
  независимый scoped review native startup hook — approve, блокирующих замечаний нет.

Pen hover/pressure воспроизводятся trusted CDP input в Chromium. Указатель
совпадает с положением пера в пределах 2px, в том числе при CSS zoom 125%,
изменении размеров и разворачивании. Hover не меняет sequence и не отправляет POST.
Проверен contact-first pen с постоянным давлением 0.5: обычный native штрих,
без выдуманного hover. Blur/cancel проверены отдельно событиями жизненного цикла;
они не выдаются за аппаратную проверку. Resize/scroll скрывают старый указатель,
следующее реальное hover move показывает его в актуальной позиции.

## Исследование и ограничения

[Исследование планшетов](2026-11-11-drawing-tablets-and-pen-hover.md) содержит
классы устройств, официальные источники и матрицу физической проверки.
Физические планшеты не тестировались: доступной модели нет, подходящие pen/tablet
HID-устройства при проверке не обнаружены. Драйвер, реальный pressure sensor,
калибровка, аппаратный palm rejection, Safari/iPad и Android не подтверждаются
Chromium-эмуляцией. Поддержка основана на полученных Pointer Events, без списка
моделей; hover/pressure доступны, когда их передаёт оборудование и браузер.

## Локальный запуск

Пользовательский запуск обновлён: frontend `http://localhost:5173`, backend 8080,
прежняя PostgreSQL `interview_online`. До обновления создан приватный backup;
сохранены прежние ключи. Только собственные frontend/backend процессы обновлены,
PostgreSQL не останавливался; main DB не использовалась для тестовых fixtures.
Проверены public health напрямую и через proxy, HTML, draw.io и local subset worker;
Flyway V37 применён успешно. Процессные flags двух холстов включены,
social auth выключен. В репозитории оба новых feature flags остаются off по умолчанию.
Production deployment и продуктовая приёмка этим отчётом не объявляются.
