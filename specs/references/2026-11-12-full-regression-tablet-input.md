# Полный регресс InterHub и виртуальное перо — 12 ноября 2026

Статус: текущий автоматический scope технически проверен; продуктовый просмотр
ожидается. Ошибок продукта в итоговом проверенном наборе не обнаружено.
Машиночитаемые результаты: [JSON](2026-11-12-full-regression-results.json).

## Изменение интерфейса

- Название режима в селекторе, подтверждении, уведомлении и подписи кандидата —
  **drawio**. API/сохранённый ключ `diagram` не менялся.
- Обе кнопки разворачивания холстов — **«На весь экран»**. Возврат —
  «Вернуться в комнату». Новые подписи проверены у управляющего и кандидата.
- Других изменений production-кода в этой итерации нет. Ранее добавленные
  совместность, права, цвета, hover, история и локальные ресурсы сохранены.

Контракты: [P2.1 R-08](../features/p2-1-room-layout-modes.md),
[P2.4 R-01/R-12](../features/p2-4-room-diagrams.md),
[P2.5 R-03/R-08/R-14](../features/p2-5-room-whiteboard.md),
[P6 R-09](../features/p6-release-gates.md).

## Полный автоматический набор

| Проверка | Результат | Evidence |
| --- | --- | --- |
| Backend: полный `mvn test`, без фильтров/skip | 77 suites, **529/529 PASS**, 0 ошибок/пропусков | [backend summary](/var/folders/x6/8g_rbv593g9fb5mktbl8knmh0000gn/T/interhub-full-backend-final-20261112-bqdei93z/summary.json) |
| Frontend: все unit/contract `.test.ts` / `.test.mjs` | **219/219 PASS**, 0 отмен/пропусков | `/tmp/interhub-frontend-full-unit-contract-20261112.log` |
| Служебные scripts tests | **37/37 PASS** | `/tmp/interhub-scripts-full-regression-20261112.log` |
| Полный `npm run e2e:all` | **118/118 файлов**, 115 production + 3 development; **619 PASS**, 0 ошибок/отмен; 1 условный contract отмечен ниже | Итоговый `summary.json` в `browser.reportDir` машинного отчёта |
| Дополнительный полный invitation-management profile | **15/15 PASS**, включая ранее условный contract; 14 пересекаются с основным набором, **1 уникальная дополнительная проверка** | `/tmp/interhub-native-ax-contract-matrix-20261112.log` |
| Реальный виртуальный планшет ОС | **1/1 production witness PASS**, 52 trusted pen events, CDP drawing dispatches 0 | [Отчёт и доказательства](2026-11-12-native-virtual-pen.md) |
| Типы, frontend build OFF/ON + compression, backend JAR | PASS | `.run/nov12-typecheck.log`, `.run/nov12-build-{off,on}.log`, backend summary |
| Shell/Compose | 6 shell syntax checks + 4 корректно объединённых Compose variants — PASS | `.run/nov12-shell-compose-summary.json` |

Итого **1406 уникальных пройденных тестов**: 529 + 219 + 37 + 620 browser cases
по объявленным профилям + 1 OS pen witness. Повторные focused проверки и 14
пересекающихся invitation cases не прибавляются второй раз. Типы/сборки/config
в это число не входят. Rspack завершил обе сборки с двумя предупреждениями
размера assets/entrypoint, без ошибок сборки.

Основной полный E2E выполнен одним непрерванным запуском на окончательном снимке:
все 118 файлов завершились с exit 0, совпадение discovery/result set проверено.
`FEATURE_ROOM_DIAGRAMS_ENABLED` и `FEATURE_ROOM_WHITEBOARD_ENABLED` включены только
в дочерних тестовых процессах; social login выключен. Default flags продукта
не менялись. Названные development chunk сценарии выполнены именно в dev-сборке.

Один case `teams/invitation-native-ax-lifecycle` условно пропускается в основном
профиле. По исходникам это **чистый collector/barrier contract с fake page и
stub focus**, а не настоящая работа с окнами ОС. Он действительно выполнен
дополнительным полным 15-case профилем с opt-in flags на тех же неизменных
исходниках. Основной TAP не переписан задним числом в «620/620 без пропусков».
Реальный live Native AX manual witness остаётся отдельной непроверенной областью.
Google/VK E2E-файл исключён явно по действующему решению пользователя.

## Какие пользовательские области покрыты

Полный discovery включает аккаунты и парольный вход, роли/отзыв прав,
командные пространства и приглашения, каталоги/библиотеки задач, программы,
создание PERSONAL/TEAM интервью, комнату и панели, Code/Markdown/drawio/Доску,
публикацию шагов и приватные материалы интервьюеров, чат/заметки/активность,
совместное редактирование и восстановление, завершение/readonly и экспорт,
навигацию, темы и геометрию desktop/tablet, dev runtime/recovery.
Негативные и concurrent проверки backend дополняют видимые UI сценарии.

Перьевые capability profiles 16384/8192 входят в основной browser suite:
все canvas gestures — trusted `pen`, pressure/цвета двух авторов, eraser/Undo,
offline/reconnect/reload и JSON/PNG/SVG проверены без mouse fallback.
Отдельно настоящий generic OS pen прошёл Linux uinput/драйверный путь до InterHub.
Это не сертификат физического XPPen/Parblo: подробные границы в
[отчёте виртуального пера](2026-11-12-native-virtual-pen.md).

## Найденные и исправленные тестовые предпосылки

- В двух migration tests актуализирован ожидаемый head **34 → 37** после V35–V37.
  Содержательные migration/data/rights проверки сохранены; затем повторён весь backend suite.
- Demo/continuity helpers теперь проверяют редактор по умолчанию в узкой комнате,
  явно открывают шаги и проверяют возврат. Старое ожидание выбранных шагов до
  пользовательского действия противоречило P0.3.
- Shared-mode/step smoke ожидают точный набор режимов по flags: четыре ON, два OFF.
  Отмена, переключение, shared state и переходы не ослаблены.
- Markdown continuity явно возвращает страницу интервьюера на передний план
  после открытия кандидата и проверяет CodeMirror focus/caret/полный набранный
  документ до выпуска native Worker replies. Все проверки paint, scroll,
  долговременного текста и приватности сохранены. Исходный единичный отказ
  не воспроизведён: доказанной production-ошибкой Markdown он не объявляется.
- Общий runner отражает canvas feature matrix в плане и применяет её в собственных
  runtime; новые холсты не остаются непроверенными из-за default-off flags.

Два диагностических прогона с устаревшими предпосылками намеренно остановлены
после выявления причин. Их результаты сохранены отдельно и не считаются PASS.
Итог выше относится к последующему полному непрерванному набору и явно указанному
дополнительному contract-профилю; это не объединение зелёных частей разных кодовых снимков.

## Изоляция, актуальность и ограничения

Тестовые backend/frontend процессы и scratch PostgreSQL schemas принадлежат
runner. Main `interview_online`, 8080/5173 не используются для fixtures.
Все 58 наблюдавшихся backend test schemas удалены; JAR содержит V35–V37 и не
содержит E2E fixture controllers. SHA-256 **383 продуктовых файлов** проверен
после прогона: изменений относительно замороженного снимка нет.
Временная tablet VM, образы, ключи и туннели удалены.

Независимая проверка discovery/isolation/results и OS pen evidence — approve,
блокирующих продуктовых замечаний нет. Полный автоматический набор не является
физической сертификацией всех моделей/драйверов, тестом всех браузеров, live
Native AX witness или приёмкой многопроцессной production topology. Продуктовая
приёмка и ранее отложенные направления остаются отдельными.

Пользовательское локальное приложение продолжает работать на
`http://localhost:5173`; health через API proxy проверен. Для этой итерации
его процессы и PostgreSQL не перезапускались; новые подписи доставляет текущий
dev-сервер. Production deployment/commit не выполнялись.
