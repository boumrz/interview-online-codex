# P4.2 — обязательные материалы внутри интервью

Статус: реализована; результаты прежних проверок и границы ниже. Актуализировано: 2026-10-02.
Результат: выбранная основа программы остаётся зафиксированной, extras можно
менять по обычным правам, решение кандидата не блокируется обязательностью задачи.

## Границы и термины

Стандарт редактируется по [P4.1](p4-1-interview-programme-standard.md);
создание/права — [P1.5](p1-5-team-interview-creation.md); lifecycle записей —
[P3.3](p3-3-interview-result.md). Mandatory — выбранная задача опубликованной
программы; extras — задачи вне этой основы. Snapshot — копия материалов в
интервью; solution — код решения опубликованной задачи, отдельно от starterCode.

## Требования

- **R-01. Выбор:** программа задаёт default задачи, но до создания любую можно
  снять. Явный `selectedTaskIds` определяет итоговый состав/порядок, включая
  пустой; оставленные programme tasks помечаются mandatory, extras — нет.
  Без поля сохраняется programme-first + extras с исключением дублей.
  Free interview без программы остаётся доступным.
- **R-02. Зафиксированный контекст:** создание сохраняет programmeId/origin/version,
  source task template ID и snapshot выбранных материалов. Изменение стандарта
  после создания не обновляет существующее интервью автоматически. Сохранённые
  programmeId/origin/version, source task template ID и mandatory-признак не
  подменяются room mutation или legacy entry points.
- **R-03. Защищённая основа:** выбранную mandatory задачу нельзя переименовать/
  удалить, изменить её live язык/условие или manager preparation workspace
  (code/Yjs/language/briefing/focus). Серверный отказ —
  `409 ROOM_MANDATORY_TASK_LOCKED`, без частичного изменения. Ограничение должно
  действовать через REST и realtime, включая legacy PATCH/DELETE/reorder/import/relay.
- **R-04. Решение и extras:** live solution опубликованной mandatory задачи
  остаётся редактируемым по текущей роли и lifecycle. Extras переименовываются,
  удаляются и подготавливаются по обычным правам. Mandatory не расширяет права
  candidate в finished и не разрешает запись в frozen/archived.
- **R-05. Устаревший preview:** перед записью комнаты сервер сравнивает programmeId
  и programmeVersion запроса с текущей resolved программой. Несовпадение →
  `409 TEAM_PROGRAMME_VERSION_CONFLICT`, комнаты нет. `currentRevision` в этом
  ответе содержит текущую programme **version**, несмотря на название поля;
  если текущей версии нет, поле отсутствует. Это отличается от revision-конфликта
  редактора стандарта P4.1.
- **R-06. Восстановление формы:** конфликт сохраняет название и форму, объясняет
  изменение и блокирует повтор создания до «Проверить обновлённые задачи».
  Повторное чтение треков/вакансий обновляет preview/default selection; после
  просмотра организатор снова создаёт с актуальной version, выбранный extra
  сохраняется. Опубликованная основа в комнате показана read-only для структуры,
  а поле решения сохраняет обычное допустимое редактирование.

## Приёмка и проверка

| ID | Требования | Сценарий → результат | Проверка |
| --- | --- | --- | --- |
| AC-01 | R-01–R-02 | Явный/legacy выбор → верный порядок/mandatory/snapshot; новый стандарт не меняет старую комнату | Creation PostgreSQL integration |
| AC-02 | R-03–R-04 | Mandatory rename/delete/language/briefing/workspace → 409 без записи; live candidate solution и extras → допустимое сохранение | Mandatory integration через REST/realtime |
| AC-03 | R-05–R-06 | Стандарт изменился после preview → 409 без комнаты; refresh и повтор → актуальная version/сохранённый extra | Version integration + team-workspaces E2E |
| AC-04 | R-01, R-04 | Free interview работает; finished/frozen/archived соблюдают роли/ограничения | Creation + lifecycle integration |

Основания детализации: `TeamInterviewCreationIntegrationTest` (pin/version conflict,
mandatory mutation и selected foundation), `TeamInterviewService`, `RoomService`,
`CollaborationService`, `e2e-team-workspaces.mjs`. Это read-only сверка существующих
контрактов и тестов 02.10, не свежий PASS. Полную отдельную матрицу всех
reorder/import обходов при этом не запускали; R-03 сохраняет прежний критерий
и требует подходящего покрытия при изменении таких entry points.
[Исходная краткая редакция](../references/history/p4-2-mandatory-programme-interview-before-2026-10-02.md)
и [прежнее UI evidence](../references/ui-2-verification-2026-09-27.md) сохранены.
