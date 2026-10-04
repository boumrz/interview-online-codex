# UI.2 — проверка девяти замечаний от 20:37

Спецификация обновлена перед реализацией: [UI.2](../features/ui-2-usability-theme-polish.md) и [P3.4](../features/p3-4-hiring-export.md). OpenSpec не использовался. Дизайнер независимо провёл аудит исходников и браузера; реализация разделена между root, UI worker и backend worker.

## Исправления

| Пункт | Результат |
| --- | --- |
|1. Понятность профиля | «Я участвую в найме» с объяснением раздела кандидатов и Excel доступных интервью. Switch сохраняет confirmed state, pending, retry и server permissions. Повторная надпись состояния заменена коротким сообщением «Сохранено». |
|2. Склеивание текстов | Явные строки и gap в участниках, приглашениях, empty-state, предложениях владельцам, очереди без владельца, архиве треков/вакансий и HR результатах. Inline Text не изменён глобально, layout применён к фактическому Card body. |
|3. Селекторы | Language filter200×32px; устранён конфликт внешнего и внутреннего min-height. Поля форм сохраняют ширину колонки, workspace selector240px. |
|4. Табы/расположение | Компактные табы библиотек с согласованным gutter и стабильным selected hover, выровненная панель наборов, иконка/заголовок на общей оси, боковые отступы16px на планшете. HR actions имеют достаточную ширину; широкая таблица прокручивается внутри своего контейнера. |
|5. Выход | Проверены центры видимого текста, профиля и кнопок; общая высота36px в personal/team/legacy header. |
|6. Период | Короткие поля «С»/«По», без повторных инструкций календаря. Правила МСК/включительных границ/резервной даты в hover/focus tooltip; ошибка отдельной строкой и не сдвигает поля/кнопку. Применённый период, сброс и экспорт сохранены. |
|7. Тема справа | DOM/визуальный порядок personal/team/legacy/room/landing; theme последняя. Login/invitation проверены как уже корректные. Клавиатурный порядок сохраняется. |
|8. Мои заметки | Убрано «Только для вас». Информер24×24 у заголовка объясняет приватность по hover и отдельно проверенному keyboard focus; без вложенной кнопки в tab и без мерцания border. Заголовок заметок с информером доступен при компактной раскладке. Экспорт остаётся справа. |
|9. TEAM Excel | «Кандидаты» доступны нанимающему в текущей команде, в том числе через меню переполнения. Общий кабинет результатов/периода/Excel использует teamId, не показывает PERSONAL или другие TEAM. Выгрузка соответствует применённому периоду, а не ещё не применённым датам. Смена команды сбрасывает контекст и отменяет незавершённую выгрузку. |

## Проверки

| Набор | Результат | Evidence |
| --- | --- | --- |
| Backend HR/workbook/team permissions |113/113, failures/errors/skipped0 | `.run/hr-team-export-final.log`, XML `backend/target/surefire-reports/` |
| Заключительный браузерный прогон на5173/8080 после применения всех исправлений |61/61, failures/skipped0 | `frontend/.run/ui2-2037-main-final.log` |
| Новый isolated runtime18081/5174, отдельная schema |60/60 | `frontend/.run/ui2-2037-isolated.log` |
| Geometry worker: layout9 + header8 + hiring2 на5173/8080 |19/19 | `frontend/.run/layout-followup-final-regressions.log` |
| Notes informer focus и положение экспорта |RED → GREEN | `frontend/.run/ui2-notes-focus-red.log`, `frontend/.run/ui2-notes-export-axis-red.log`; усиленные assertions в новом clarity наборе |
| HR action text на768px |RED воспроизведён перед scoped fix | `frontend/.run/ui2-hr-actions-red.log`; новый clarity сценарий проверяет, что текст целиком внутри кнопки |
| Заключительный независимый designer audit |approve,8/8 комбинаций | `frontend/.run/ux-final-team-notes.log`, screenshots `ux-final-team-fixed-*`, `ux-final-notes-focus-*` |
| Typecheck / production build / diff-check |PASS; build содержит два предупреждения размера bundle | `frontend/.run/ui2-2037-final-typecheck.log`, `frontend/.run/ui2-2037-final-build.log`; `git diff --check` |

Backend набор: `HrTeamWorkspaceExportIntegrationTest`6 новых сценариев, `TeamInterviewCreationIntegrationTest`44, `HrRoomTrackingIntegrationTest`21, `HrPermissionPoolIntegrationTest`4, `HiringManagerPreviewIntegrationTest`7, `HrWorkbookIntegrationTest`5, `HrWorkbookCleanupTest`1, `HrRoleRemovalIntegrationTest`21, `HrAccountProfileIntegrationTest`4.

Новые backend сценарии сначала дали6 ожидаемых failures: игнорируемый teamId, чужие PERSONAL/TEAM строки, некорректный пустой экспорт и отозванные/исторические полномочия. После исправления прочитан реальный XLSX через WorkbookFactory: точные ID строк, порядок, период, verdict/score, текстовые formula-like значения. Проверены pagination/count, пустой результат, не-HR, чужой/неактивный/некорректный scope, отсутствие назначения и отзыв HR/membership/team/current room grant во время генерации. Доступ проверяется повторно даже для пустого XLSX; отозванный доступ возвращает409 без файла.

Isolated браузерный набор включает прежние HR32, header UX8, geometry9, новый clarity5, finished actions4, code sync и private notes/slash/export. Проверены реальные запросы и скачивание XLSX с чтением XML ZIP, переход в TEAM кандидатов через навигацию, тот же период списка/файла и отмена отложенной выгрузки через SPA переключатель пространства. Дополнительный шестой clarity тест добавлен по замечанию независимого дизайнера после этого прогона.

Матрица геометрии:1366/1024/768px, light/dark, видимый текст кнопок/контролов, title/description gaps, selected hover, fixed workspace width, отсутствие горизонтального overflow страницы. Legacy admin header использует безопасные сетевые fixture-ответы только для геометрии; проверки его реальных прав этим сценарием не заявляются. Остальные create/invite/archive потоки используют собственные реальные тестовые сущности.

Визуальный designer audit просмотрел24 комбинации профиля, периода/ошибок, участников, наборов, заметок и TEAM кабинета, плюс20 обновлённых geometry screenshots. Он выявил тесную колонку действий HR на768px; замечание закрыто проверкой границ текста после расширения колонки. После применения backend дизайнер независимо создал две команды и личное интервью: TEAM кабинет показывает только текущую команду. Завершающая матрица1366/768px × light/dark подтверждает текст целиком внутри кнопки и локальную прокрутку таблицы без overflow страницы; отдельные4 комбинации подтверждают tooltip заметок по keyboard focus без hover. Итоговый verdict — approve. Root дополнительно просмотрел завершающие screenshots узкого TEAM кабинета и заметок.

## Применение

Backend8080 обновлён по ранее полученному явному разрешению на перезапуск. После исправления локального launch configuration сервер отвечает `/api/public/health`200 с `status: ok`; используются прежняя база и сохранённые локальные ключи. Frontend5173 и PostgreSQL не перезапускались. Isolated runtime остановлен, временная schema удалена. Исходные пользовательские комнаты не изменялись; тесты создают собственные сущности. Feature flags по умолчанию остаются выключенными.

Заключительный main прогон включает HR32, header UX8, geometry9, clarity6, finished actions4, code sync и private notes/slash/export:61/61. Проверены новые сценарии и затронутые регрессии; прохождение всей исторической E2E коллекции не заявляется. Typecheck и production build завершились успешно; два предупреждения размера bundle не являются ошибками сборки. Финальные серверные полномочия и выдача XLSX проверены113 интеграционными сценариями, независимый UX verdict — approve.
