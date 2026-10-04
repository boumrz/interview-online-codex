# Команды заметок, выбор редактора и результаты действий — 03.10.2026

UI.2 R-21/R-24/R-25 и AC-17/AC-18 реализованы и технически проверены.
Продуктовый просмотр пользователем ожидается. Проект доступен на
`http://127.0.0.1:15173`, API — на `http://127.0.0.1:18080/api`.
Использовано уже запущенное локальное окружение; перезапуска в этой работе не было.

Команды `/block`, шаговые пресеты и создание пользовательского блока имеют
левое выравнивание. Явный выбор «Редактор: Код / Текст» показывает текущий
режим и объясняет сохранность обоих документов. Публичный и приватный выбор
используют прежние callbacks, роли и механизм публикации.

Сообщения о сохранении, импорте, назначении нанимающих, приглашениях,
управлении командой и экспорте перенесены в общий context-bound Ant notification
сверху. Dashboard использует тот же механизм; старый DashboardToast удалён.
Автосохранение остаётся тихим. Pending, ошибки, черновики, retry и постоянные
статусы доступа сохраняются внутри своих интерфейсов. Поздние ответы
ограждены текущим аккаунтом, токеном, командой, authority generation и unmount.
Текст popup пропускает клики к странице; его крестик и явные действия доступны.

Во время проверки найдены и исправлены дополнительные последствия переноса:
глобальный popup после ухода с профиля; поздний результат TEAM при замене
stored token до React update; прежняя ошибка PDF после смены сессии;
перекрытие следующего клика по участнику телом уведомления.

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| Новые команды/редактор/экспорт/участник, обе темы и ширины 1366/390; keyboard, reload, настоящие документы и native hit testing | 6/6 PASS | `frontend/.run/oct03-ui-feedback-validation/e2e-room-command-editor-ux-final.log`, `screenshots/` |
| Новые профиль, room metadata, приглашение нанимающего, активный import и настоящий Excel; pending/failure/retry, смена сессии и unmount | 7/7 PASS | `e2e-profile-room-action-notifications-stable-final.log` |
| Новые TEAM приглашения, управление и ownership; один результат, текущая сессия/команда, focus | 16/16 PASS | `e2e-team-action-notifications-final.log` |
| Доступный legacy Dashboard `/dashboard/admin`: profile/capability, deduplication и unmount | 3/3 PASS | `e2e-dashboard-action-notifications-final.log` |
| Полный существующий HR набор: сохранение/conflict, приглашения, кабинеты/Excel, права, архив, назначение/снятие, reconnect и поздние ответы | 33/33 PASS | `e2e-hr-cabinet-final.log` |
| Настройки TEAM с настоящим API: transfer, pending authority refresh 403/503, late team-A; invitation replay/privacy | 4/4 + 2/2 PASS | `team-real-settings-green.log`, `team-real-invitation-green.log` |
| Существующие заметки, кликабельность шагов и chat focus | 4/4 PASS | `e2e-room-review-regressions.log` |
| Быстрый Markdown, застрявший POST, undo до ACK, conflict/late snapshot, публикация, demotion/regrant и первая приватная правка | 9/9 сценариев PASS | `e2e-markdown-delivery-reliability-native.log`; неизменённый тест |
| Публичный focus/fullscreen, независимые private/public steps, room smoke, PDF progress и slash/export | 5 script flow PASS | `room-regressions-results.json` и соответствующие логи; PDF содержит 120 сохранённых заметок, настоящий PDF и встроенный шрифт |
| Все frontend unit/contract | 76/76 PASS | `unit-contract-final.log` |
| TypeScript, production build и scoped whitespace check | PASS | `typecheck-final.log`, `build-final.log`; build сохраняет 2 предупреждения существующих размеров assets/entrypoint |

Все имена логов без префикса относятся к
`frontend/.run/oct03-ui-feedback-validation/`. Четыре новых browser файла
содержат 32 сценария. Владение уведомлениями и ограждение поздних ответов
проверены независимым scoped review; найденные замечания закрыты кодом и
регрессиями. Backend, ролевая матрица и протокол realtime не менялись в этой
доработке. Полный backend и общий 93-file browser прогон 02.10 остаются
[историческими доказательствами](2026-10-02-room-fixes-validation.md), повторно
для текущей правки не заявляются.

Состояние исходников после финальной сборки: `frontend/src`, 109 файлов,
manifest SHA-256
`940f33f1194d12b14eca86d4f669cb14b4ff2da86ef0914ff63c21cf7bdbcf52`.
Полный manifest — `frontend/.run/oct03-ui-feedback-validation/source-manifest.json`.
Frontend и API health через прямой endpoint и proxy возвращают HTTP 200 / `ok`.

До кода подтверждены поведенческие RED: выравнивание/отсутствие нового выбора,
отсутствие standard popup после подтверждения, поздние profile/TEAM результаты,
прежняя ошибка PDF и native hit testing popup. Логи RED сохранены отдельно.
Первый широкий HR прогон 30/33 выявил два pointer interception и ожидание
одного текста после двух разных сохранений: interception исправлен; тест
двух действий теперь явно закрывает первое уведомление. Финальный полный HR
прогон 33/33 — PASS.

Setup ошибки не считаются RED: недоступный retired Dashboard route;
попытка pointer check скрытого native radio; ранняя geometry во время motion;
лишнее ожидание завершающего перевода строки после канонизации. Первый
Markdown запуск с добавленным `E2E_BROWSER_API_ORIGIN` завершился setup timeout:
неизменённый native same-origin запуск затем прошёл все 9 сценариев. Потеря
Request headers при переписывании Request в URL — вывод по исходнику harness.
Один параллельный profile прогон завершился навигацией того же room во время
генерации `public/theme-tokens.css` сборкой; после завершения сборки стабильный
прогон 7/7 — PASS. Первые неуспешные логи и результаты сохранены, не заменены
финальными файлами.

Пределы проверки: dormant PasteTaskCodeField, default HiringManagerPicker,
retired rename/picker legacy callers проверены чтением кода; браузерное
покрытие этих недоступных путей не заявляется. Новые ownership случаи используют
контролируемые API ответы; существующие HR и TEAM проверки используют настоящий
API. Leave с последующим unavailable-team rendering не имеет отдельного
focus-fallback assertion; реальный transfer проверяет fallback на заголовок.
Новый native macOS lifecycle/AX прогон здесь не выполнялся.
