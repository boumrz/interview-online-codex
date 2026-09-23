## Purpose

Убрать лишний выбор редактора и вернуть пользователю безопасное изменение размеров
чат- и контекстных панелей комнаты без нарушения live-сессии или приватности.

## ADDED Requirements

### Requirement: Room surface navigation omits the redundant editor tab while preserving editor semantics

В desktop/tablet комнате видимая навигация контекстных поверхностей SHALL NOT
предоставлять вкладку, кнопку или иной selectable control с названием «Редактор».
Редактор SHALL оставаться подписанной region/рабочей областью с существующими
семантиками CodeMirror/Yjs, а в режимах «Рабочий» и «Обзор» SHALL оставаться
постоянно видимым базовым блоком. Удаление control SHALL NOT удалять editor DOM
subtree, менять доступ к коду, язык, selection, scroll, локальный шаг или published
step authority.

Прямая навигация SHALL содержать только вспомогательные поверхности в постоянном
порядке «Шаги», «Условие», «Мои заметки», «Чат», «Активность». В режиме «Фокус»,
где единственной видимой поверхностью является editor, auxiliary `tablist` SHALL
быть скрыт целиком, а region SHALL иметь прямое доступное имя «Редактор» без ссылки
на отсутствующую вкладку. Если в «Фокусе» отображается вспомогательная поверхность,
tablist SHALL содержать только пять вспомогательных controls. Переход в «Рабочий»
из вспомогательной поверхности SHALL возвращать видимый редактор без отдельной
вкладки «Редактор» и без потери активной вспомогательной поверхности. Roving
keyboard navigation, Home/End, доступные имена и focus-visible состояние SHALL
охватывать только реально отображённые вспомогательные controls. Кандидат SHALL
сохранять прежнее отсутствие внутренних панелей и не получать новый control или
внутренние данные.

Pre-implementation acceptance-test level: **E2E** в существующем
`frontend/tests/e2e/interview/e2e-room-context-panels.mjs`, потому что требуется
проверить видимые controls, landmarks, focus и сохранность редактора в реальной
room/Yjs сессии.

#### Scenario: Интервьюер открывает рабочую комнату
- **WHEN** комната загружена в рабочем или обзорном режиме
- **THEN** редактор остаётся видимой подписанной рабочей областью
- **AND** в списке selectable surface controls нет действия с названием «Редактор», но доступны «Шаги», «Условие», «Мои заметки», «Чат» и «Активность» по правам

#### Scenario: Возврат из фокусного чата не требует вкладки редактора
- **WHEN** интервьюер в режиме «Фокус» открыл «Чат» и переключается в «Рабочий» клавиатурой
- **THEN** редактор и ранее выбранная вспомогательная поверхность вновь видимы
- **AND** черновик чата, курсор/selection редактора, локальный шаг и published step не меняются

#### Scenario: Фокус с одним редактором не оставляет пустую навигацию
- **WHEN** geometry переводит комнату в «Фокус» с единственной видимой поверхностью editor
- **THEN** в DOM нет auxiliary tablist и selectable control «Редактор»
- **AND** видимый editor region имеет прямое доступное имя «Редактор» и сохраняет CodeMirror/Yjs subtree

#### Scenario: Кандидат открывает ту же комнату
- **WHEN** кандидат загружает комнату после удаления editor control
- **THEN** он видит допустимый редактор по прежней роли
- **AND** внутренние вспомогательные controls и их содержимое по-прежнему отсутствуют

### Requirement: Visible room context panels are locally resizable within safe geometry

На desktop/tablet с доступной шириной не менее 768 CSS px пользователь SHALL иметь
возможность изменять размер каждой одновременно видимой пары «редактор ↔ выбранная
контекстная поверхность» в режиме «Рабочий». В режиме «Обзор» пользователь SHALL
также иметь доступные разделители для изменения ширины правой контекстной колонки и,
когда одновременно видны чат и активность, высоты их разделения. Режим «Фокус» с
одной поверхностью SHALL не показывать неработающий разделитель. Уменьшение или
увеличение окна/zoom SHALL автоматически ограничивать либо скрывать разделитель,
если иначе нарушаются минимумы readable layout; оно SHALL NOT создавать наложение,
общий horizontal overflow или панель меньше минимальных размеров capability
`room-context-panels`.

Каждый доступный разделитель SHALL поддерживать drag pointer/mouse и keyboard
Arrow keys, Home и End, иметь `role="separator"`, корректные orientation и
`aria-valuemin`/`aria-valuemax`/`aria-valuenow`, доступное имя с указанием изменяемой
области и видимый focus. Изменения SHALL быть локальны текущему пользователю и
текущему lifetime открытой route комнаты: они сохраняются при смене режима и
resizing viewport, пока поддерживаются минимумы, но после полной reload страницы
возвращаются к дефолту. Новые размеры SHALL NOT записываться в server, RTK cache,
SSE/POST relay, Yjs document или persistent browser storage и SHALL NOT влиять на
другого участника или другую комнату.

Во время drag, keyboard resize, viewport resize или browser zoom редактор и
контекстные subtrees SHALL оставаться mounted. Эти действия SHALL NOT выполнить
submit, synthetic input/change, RTK mutation, историю/чат request, Yjs update,
смену языка, изменение published step, reconnect или новую room session. Существующий
legacy-resizer левой owner-панели SHALL сохранять своё текущее поведение; новый
контекстный resize не должен конфликтовать с ним.

Для этой реализации grid gap SHALL быть `10px`, а keyboard step SHALL быть
`16 CSS px`. Work vertical separator SHALL изменять ширину правой auxiliary
поверхности в bounds `[320, surfaceWidth - 480 - 10]`. Overview vertical separator
SHALL изменять ширину правой context column в bounds
`[320, surfaceWidth - 240 - 480 - 20]`. Когда в Overview одновременно видны chat и
activity, horizontal separator SHALL изменять lower chat height в bounds
`[320, surfaceHeight - 240 - 10]`. Каждое значение SHALL быть integer CSS pixel;
если максимум меньше минимума, соответствующий divider SHALL отсутствовать, а не
создавать overlap. Vertical ArrowRight/ArrowLeft SHALL соответственно увеличивать/
уменьшать правую context width; horizontal ArrowDown/ArrowUp — увеличивать/
уменьшать lower chat height; Home/End SHALL выбирать minimum/maximum.

Pre-implementation acceptance-test level: **E2E** в существующем
`frontend/tests/e2e/interview/e2e-room-context-panels.mjs` для pointer/keyboard
resize, min/max, mode changes, zoom, route reload reset и отсутствия mutation;
**unit exception** для детерминированного clamp/reducer, потому что граничная
арифметика пропорционально проверяется без нестабильности browser drag.

AC-11 regression SHALL быть обновлён, а не сохранён с прежним six-tab contract:
он проверяет пять auxiliary tabs, directly named editor-only Focus region и новые
splitters, одновременно сохраняя прежние checks mounted editor/Yjs, draft,
selection, scroll, role visibility и geometry. AC-12 не является regression gate
этого remediation, потому что parent task 14.3 ещё не завершён.

#### Scenario: Интервьюер расширяет чат в рабочем режиме
- **WHEN** на поддерживаемом desktop/tablet viewport открыт «Чат» рядом с редактором и пользователь перемещает его разделитель pointer или Arrow keys
- **THEN** ширина чата изменяется в объявленных minimum/maximum границах, а редактор остаётся читаемым и без overlap
- **AND** divider сообщает новое значение assistive technology и не отправляет комнатное событие

#### Scenario: Обзор сохраняет безопасные размеры при изменении окна
- **WHEN** в обзоре одновременно открыты чат и активность, пользователь изменил их split, а затем уменьшил окно или увеличил zoom
- **THEN** UI clamp-ит layout либо переходит в допустимый более компактный режим до нарушения минимумов
- **AND** active surface, draft, editor selection, scroll и настроенный split сохраняются настолько, насколько допускает новая геометрия, без автоматического возврата в обзор

#### Scenario: Локальный размер не переносится в другую сессию
- **WHEN** интервьюер изменил размер панели, открывает другую комнату или полностью перезагружает страницу
- **THEN** другая комната и новая загрузка используют дефолтную геометрию
- **AND** в network/SSE/Yjs trace отсутствуют события, вызванные только изменением размера
