# Личные карточки интервью — 2026-10-05

Контракты: [UI.2 R-30/AC-24](../features/ui-2-usability-theme-polish.md),
[P2.3 R-10/AC-09](../features/p2-3-room-assignments.md).

Личный список переведён с таблицы на общий с TEAM компонент `InterviewCard`:
название и создание, количество задач и статус, контекст, порядок задач,
доступные имена интервьюеров, сведения кандидата и дата, завершение/вердикт.
Кнопки и оформление общие: редактор, публичная ссылка кандидата, вход, корзина.
Функции TEAM, его права и lifecycle сохранены; PERSONAL не получает фиктивные
треки/вакансии или frozen/resume. Владелец меняет название/сведения и удаляет;
интервьюер меняет сведения/нанимающих с readonly названием; кандидат только входит.

Общий `InterviewEditAction` использует разные PERSONAL/TEAM API адаптеры.
Новый PERSONAL GET/PATCH `/me/rooms/{roomId}/details` сохраняет название и
сведения одним атомарным действием с общей metadata revision. Старое
переименование тоже увеличивает revision. Конфликт не записывает часть данных;
черновик можно исправить, повторить или заменить актуальными сведениями.
Отзыв доступа и снятие собственной роли очищают private форму; поздние ответы
после ухода/смены сессии не возвращают прежние данные. Компактный `/me/rooms`
возвращает задачи без кода/условий/заметок, имена интервьюеров только менеджерам;
кандидат не запрашивает private metadata или редактор.

## Проверки

| Проверка | Результат |
| --- | --- |
| `PersonalInterviewDetailsIntegrationTest` | **9/9 PASS**, PostgreSQL 16.13: права, scope, compact privacy, malformed-body rollback, CAS/legacy rename и реальная гонка отзыва прав после lock wait |
| `e2e-personal-interview-cards.mjs` | **7/7 PASS**, реальные API: действия, clipboard privacy, search/refresh, atomicsave/retry/conflict, interviewer/candidate, revoke/self-removal/lateGET, shared styles и mobile |
| `e2e-team-interview-edit.mjs` | **5/5 PASS**, прежние TEAM creation/edit/expired-session сценарии |
| `e2e-ui2-personal.mjs` | **3/3 PASS**, новый общий editor и прежние личные формы/библиотека |
| Затронутые personal сценарии `e2e-workspace-navigation.mjs` | **6/6 PASS**, список/роли/геометрия/rename/delete/metadata |
| TypeScript и сборки | **PASS**, production Rspack и backend package |
| Visual | **PASS**, сравнение computed styles TEAM/PERSONAL, light/dark desktop и 390px; mobile scrollWidth=390, карточка внутри viewport |
| Независимый scoped review | **APPROVE**, security/reliability; обязательных открытых замечаний нет |

Итого: **9 backend + 21 browser проверка**, без ошибок/пропусков.
RED подтверждён до реализации: новый личный список отсутствовал, setup/API
успешны; backend не имел details routes/summary fields/общей revision.
Ошибочный тестовый TEAM scope fixture исправлен и не считался RED.

Reviewer отдельно проверил реальные PostgreSQL XML и защиту после ожидания
блокировки. Найденные риски stale private metadata и self-removal устранены;
новые browser negative сценарии подтверждают отсутствие private данных.
Браузерные прогоны использовали immutable production build, отдельные
процессы/порты и тестовые PostgreSQL схемы; fixtures не создавались в рабочей БД.

## Evidence и локальный запуск

Git ignored evidence: `.run/personal-interview-cards-red.log`,
`.run/personal-interview-cards-green.log`,
`.run/personal-interview-cards-navigation-green.log`,
`.run/personal-interview-cards-backend-green.log`,
`.run/personal-interview-cards-evidence/` (XML, измерения и screenshots).

После проверок локальные backend/frontend перезапущены по прежнему запросу
пользователя. Сохранены рабочая БД, стабильные ключи чата/приглашений и предыдущая
конфигурация; новый сервер запущен из собранного JAR. Новые API доступны,
health/frontend проверены. GOOGLE/VK общий флаг остаётся false; providers=[];
обычный login не делает social requests и не загружает их assets. Приватные
значения не выводились. Миграции запускаются штатно; исторический отчёт
отложенной AUTH.1 описывает состояние до этого последующего перезапуска.

Воспроизведение из frontend:

```bash
E2E_PRODUCTION=true node tests/e2e/run-isolated.mjs tests/e2e/account/e2e-personal-interview-cards.mjs tests/e2e/teams/e2e-team-interview-edit.mjs tests/e2e/theme/e2e-ui2-personal.mjs
E2E_PRODUCTION=true E2E_TEST_NAME_PATTERN='personal owner card keeps|personal interview list combines|personal interview actions and library rows|distinct owner interviewer and candidate cards|owner deletion requires|unified interview cards expose' node tests/e2e/run-isolated.mjs tests/e2e/teams/e2e-workspace-navigation.mjs
npm run typecheck
```

Техническая проверка завершена. Продуктовый просмотр пользователем ожидается.
