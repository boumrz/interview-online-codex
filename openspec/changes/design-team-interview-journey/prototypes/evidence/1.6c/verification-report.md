# 1.6c — UX-08 / DA-03 prototype evidence

Статус: **PASS для repo-hosted prototype**. Это не production UI и не доказательство realtime delivery, persistence, Yjs continuity либо server-side authorization/audience filtering.

## Запуск

```sh
python3 -m http.server 4173 --directory openspec/changes/design-team-interview-journey/prototypes
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6c/automated-check.mjs
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6g/mobile-safari-orientation-fallback-check.mjs
```

Результат последнего запуска: оба актуальных check-файла `pass=true`; основная матрица — 44/44 geometry cases, 15 representative screenshots, 0 page/console errors, 20/20 continuity switches. Новый focused iPhone Safari fallback — 6/6 direct-landscape и 6/6 portrait→landscape случаев для DA-01–DA-06, включая room continuity.

Scroll-runway RED/GREEN и native-origin proxy ниже сохранены как история предыдущей гипотезы. Девятый реальный Safari прогон доказал, что один ordinary gesture не схлопывает browser chrome; поэтому runway больше не является заявленным iPhone UX и не используется fallback-путём.

Перед последним исправлением native-origin regression `visualViewport=667×60`, reported `offsetTop=19`, effective unobscured band 44 px дал ожидаемый RED: `pass=false`. Fixed dock повторно прибавлял offset: сверху оставался зазор, низ 44 px targets попадал под pointer-intercepting Safari accessory. Upper clicks работали, но lower hit-tests и фактический переход Chat→Editor не срабатывали.

## Проверенный UX-контракт

- Room открывается отдельной полноэкранной оболочкой без workspace sidebar. Team staff возвращается через «К интервью · Atlas», guest manager — в личное пространство, candidate — на главную/в личные комнаты без командного каталога.
- Начальный режим — Work только при фактических W≥1000/H≥440, иначе Focus. Overview доступен при W≥1320/H≥640 и включается только явно.
- В Overview при 1440×900 явно включён «Показать оба»: steps, editor, activity и chat проходят внутренние минимумы. Фактические rectangles записаны в [`bounding-rectangles.json`](bounding-rectangles.json).
- Шесть прямых действий имеют стабильный порядок: Editor, Steps, Condition, My notes, Chat, Activity. Candidate не получает этот switcher и internal content.
- Постоянная строка текущего шага видна в editor/chat/activity/notes и остальных manager panels: локальный выбор и опубликованный кандидату шаг показаны раздельно. В portrait input mode используется прежний 28 px compact context. В short landscape отдельная строка убрана, а local/published context встроен 15 px strip в textarea cell единственного 44 px dock; введённый текст остаётся 16 px и видим ниже strip.
- Публикация шага — отдельное действие только для подтверждённых room-ролей OWNER и INTERVIEWER. Guest manager, HIRING, candidate и revoked staff не получают `data-room-publish` и его handler; локальный выбор для них не выдан за публикацию.
- Pending, reconnecting, error, frozen, archived и revoked имеют разные сообщения/действия. Revoke удаляет manager shell, protected drafts и retry вместо локального возврата прежней роли.
- Новое сообщение во время чтения истории не меняет active panel, keyboard focus или scroll; unread снимается только после явного перехода к концу.

## DA-03 continuity

В одном документе введены длинный code buffer, selection 41–77, editor `scrollTop=260`, chat draft, notes draft и local step 3. Затем выполнены 20 прямых переключений панелей с повторяющимися resize 390×640, 1440×900, 1024×480, 1280×720 и 768×1024.

После цикла:

- тот же editor DOM node, `room session` и editor instance;
- `mountCount` не изменился;
- code, selection, editor scroll, оба drafts и local step совпали;
- layout менялся между Focus/Work без room remount.

Полный before/after снимок: [`report.json`](report.json), поле `continuity`.

## Геометрия, zoom и клавиатура

Проверена матрица 11 viewport × 4 zoom: 1440×900, 1366×768, 1280×720, 1024×600/480, 768×1024, 1024×768, 320/360/390×640 и 667×375; zoom 100/125/150/200%; в каждой итерации включён длинный русский контент.

- 44/44: нет общего horizontal overflow, видимые interactive targets ≥44×44 CSS px, mode соответствует измеренным W/H.
- 1440×900 Overview: editor body 771.77×591, steps body 268.81×616, activity body 369.41×240.59, chat panel 371.41×367.09, history 120 px.
- Simulated `visualViewport=390×360`, keyboard=true: compact context 28 px + six-action strip 44 px = 72 px; minimum action width 65 px; Send rect полностью внутри simulated Vh после обычного scroll. См. [`visual-viewport-keyboard.json`](visual-viewport-keyboard.json).
- Focus-driven 667×375 regression: focus chat textarea сам включает input mode; room фиксируется к текущим `visualViewport.width/height/offset`, textarea сохраняет focus и DOM identity. Keyboard mode независимо от orientation detector сворачивает history и показывает compact composer/Send без horizontal overflow. Это проверено в `report.json.realKeyboardFocus` и `focus-driven-landscape-chat.png`.
- Portrait focus+resize regression: после focus visual viewport сокращён до 390×320 без ручного scripted scroll; room имеет высоту 320 px, focus остаётся в textarea, compact step/composer/Send видимы над условной клавиатурой. См. `report.json.portraitFocusResize` и `focus-resize-portrait-chat.png`.
- Safari auto-pan regression proxy: simulated layout-coordinate `visualViewport=667×260`, `offsetTop=92`, horizontal insets 47 px. Шестикнопочная nav и composer используют explicit simulated fixed anchor 92 px, local/published context встроен в composer, focus сохранён, controls находятся между safe-area edges, overflow=0. Это отдельно от native visual-origin semantics. См. `report.json.autoPanRecovery`, `bounding-rectangles.json` и `visual-viewport-auto-pan-safe-area.png`.
- CSS-short keyboard-closed proxy: при layout viewport `667×375`, без focused input и при принудительном `data-short-landscape=false`, `@media (max-height:480px)` скрывает manager service/panel header. History остаётся доступным 64 px internal scroller, а весь compact composer и Send уже видны без прокрутки; измеренная chat panel — 561×149 px. Textarea и все видимые targets ≥44 px.
- Safari-accessory/native-origin proxy: `visualViewport=667×60` сообщает `offsetTop=19`, но native fixed origin не получает слепую прибавку offset. Верхние 44 px остаются единственной unobscured областью, следующие 16 px перекрыты pointer-intercepting accessory proxy. `elementFromPoint` подтверждает верхнюю и нижнюю точки всех шести actions, textarea и Send; lower-edge pointer clicks переключают Chat→Editor→Chat, затем тот же textarea DOM повторно получает focus. См. `report.json.shortLandscapeOpen`, `bounding-rectangles.json` и `short-landscape-keyboard-open.png`.
- Исторический expanded-chrome proxy: `scroll-runway-report.json` показывает, что искусственное расширение viewport после wheel могло дать полный dock в Chromium. Девятый real Safari record показал отсутствие такого расширения, поэтому результат не используется как support evidence и сохранён только для объяснения отклонённого решения.
- Актуальная iPhone Safari ветка: до focus любого room textarea/editor в landscape событие перехватывается и показывается «Для ввода поверните iPhone вертикально». Клавиатура и Send не запускаются. Поворот из сфокусированного portrait сохраняет draft, room session/editor instance, active panel, local/published step, selection и scroll, затем снимает focus без отправки. Возврат portrait сохраняет поле, но не фокусирует его автоматически. См. `../1.6g/mobile-safari-orientation-fallback-report.json`.
- Keyboard trace: 10/10 последовательных room controls имеют accessible name и focus outline 3 px. См. [`focus-trace.json`](focus-trace.json).

## Representative screenshots

В [`screenshots/`](screenshots/) находятся: Work owner, explicit Overview/both, phone Focus с длинным RU, reconnecting, pending chat, activity error, frozen owner, revoked staff, candidate boundary, simulated keyboard chat, focus-driven landscape chat, focus+resize portrait chat, auto-pan/safe-area, short-landscape keyboard-open и persistent current-step chat.

## Оставшийся gate

Headless Chromium и смена viewport не заменяют реальную iOS-клавиатуру, safe-area и orientation events. UX Critic должен выполнить десятый real Safari прогон: portrait input; keyboard-closed landscape viewing; direct landscape tap до keyboard open; portrait→landscape при активном поле; возврат portrait с новым явным focus. Этот файл не объявляет real-mobile gate успешным. Production доказательства AC-11/AC-12 и backend audience/revoke/reconnect выполняются последующими RED/GREEN задачами.
