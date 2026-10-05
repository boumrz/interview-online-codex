# Доработки по замечаниям пользователя — 05.10.2026

Статус: реализовано и технически проверено; независимый scoped обзор approve.
Продуктовый просмотр ожидается; email остаётся исследованием.
Текущие договоры: [UI.2](../features/ui-2-usability-theme-polish.md),
[назначения P2.3](../features/p2-3-room-assignments.md),
[создание интервью P1.5](../features/p1-5-team-interview-creation.md).

## Разбор замечаний и результат

| Замечание | Решение и границы |
| --- | --- |
| 1. «Имя для комнаты» похоже на название комнаты | При регистрации только поле «Имя», без placeholder/описания; это отображаемое имя пользователя, Unicode разрешён |
| 2. Технические ошибки fetch в интерфейсе | Единые русские сообщения для сети, timeout, parser и server; известные ошибки валидации сохраняются; status/code остаются для прав и повторов |
| 3. Избыточные пояснения | Удалены повторные вводные/пустые описания списков, карточек и форм PERSONAL/TEAM, библиотеки, профиля, настроек и комнаты; сохранены действия, права и существенные ошибки |
| 4. Долгое ожидание отсутствующего нанимающего | Indexed findById/findByNickname на сервере не содержит циклов/повторов; отсутствующий человек возвращает 404. UI раньше не отменял запросы и не имел deadline. Preview по нику получает debounce 300 мс, abort старого запроса и deadline 8 с; pending освобождается после ошибки |
| 5. Лишняя фраза при создании | Pending остаётся в кнопке, отдельная инструкция о повторной отправке удалена |
| 6. Кириллица и повтор пароля | Новая регистрация ограничивает ник/пароль печатными ASCII на клиенте и сервере; повтор обязателен в форме. Пароль не обрезается и не транслитерируется. По отдельному решению пользователя вход старых кириллических аккаунтов сохраняется |
| 7. UUID/ID в поиске и отображении | Человека ищут по точному нику, выбранного подтверждают по имени; профиль предлагает ник. Внутренние IDs не показываются в карточках, авторстве или инструкциях. API и ссылки сохраняют внутренние ключи для совместимости |
| 8. Email и восстановление | Исследовано; внедрение требует отдельного согласованного договора и рабочего транспорта писем. Ниже — обнаруженные зависимости и предлагаемый scope |

## Исследование email и восстановления

В `User.kt`/`AuthDto.kt` нет email и подтверждения почты. `AuthController.kt`
предоставляет регистрацию и вход, восстановление отсутствует. В Maven/Gradle
нет mail starter; SMTP/provider и публичный адрес восстановления не настроены.
Пароли уже хранятся BCrypt. `UserSessionRepository.deleteAllByUserId` позволяет
отозвать сессии после сброса; у сессии есть `createdAt`, текущая модель не задаёт
expiry. Внедрение восстановления не должно неявно менять expiry обычного входа.

Предлагаемые законченные этапы:

1. Nullable email и признак подтверждения без изменения IDs/ников существующих
   аккаунтов. Старый пользователь добавляет почту после повторной проверки
   пароля и подтверждения владения ящиком. Для нового аккаунта почта становится
   доступной для восстановления только после подтверждения. Вход по нику остаётся.
2. Запрос восстановления даёт одинаковый внешний ответ для известного и
   неизвестного email, ограничивает частоту. Криптографически случайная ссылка
   имеет ограниченный срок и одно применение; в базе хранится только хеш токена.
   Сброс атомарно меняет BCrypt, отзывает остальные ссылки и все сессии,
   после чего пользователь проходит обычный вход. Ссылка не попадает в logs
   или recovery storage; доверенный публичный origin задаётся конфигурацией.
3. Mail transport через `spring-boot-starter-mail`/`JavaMailSender`, заданные
   connection/read/write timeout. Для локальных проверок — перехватчик писем;
   для выпуска — настроенный отправитель и проверенная реальная доставка.
   PostgreSQL/browser проверки покрывают expiry, повтор, гонки, нейтральный
   ответ неизвестному email, смену почты и отзыв сессий.

До реализации следует выбрать обязательность email при новой регистрации,
поставщика/отправителя, публичный origin и срок ссылки. Эти значения не
придумываются в текущей доработке. Существующие аккаунты сохраняются.

Основание для защит и доставки: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
[OWASP Email Validation and Verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html),
[Spring Boot 3.3 — Sending Email](https://docs.spring.io/spring-boot/3.3/reference/io/email.html).
Рекомендация относится к будущей фиче; email-восстановление пока не реализовано.

## Проверки

| Область | Реально выполненная проверка | Результат |
| --- | --- | --- |
| Авторизация | `AuthCredentialPolicyIntegrationTest` в копии backend, PostgreSQL 16; отказ без user/session writes, ASCII punctuation/spaces, точный старый кириллический вход | 3/3 PASS, RED 200 вместо 400 перед реализацией |
| Nickname preview / room authority | `HiringManagerNicknameIntegrationTest`, PostgreSQL 16: lookup/404/малый response, malformed request, TEAM eligibility, гостевые credentials, grant/revoke/event-token и converted scope | 7/7 PASS; RED подтверждён |
| Совместимость preview | Прежний `HiringManagerPreviewIntegrationTest` на H2 (не PostgreSQL) | 7/7 PASS |
| Формы/вход | Browser registration/network retry 1/1; profile hydration/races 10/10; auth navigation, dashboard smoke, theme switch по 1/1 | PASS |
| Ник в интерфейсе | Selector 6/6: not-found/network/timeout/stale/edit; реальные PERSONAL/TEAM creation/edit + guest close 3/3; targeted HR 9/9 (7 первоначально, 2 после актуализации fixture) | PASS |
| Интервью/network | Immutable production browser suite `e2e-team-interview-edit.mjs`: потерянный успешный ответ без дубля, PATCH network/draft/retry, metadata, 401 и stale context | 5/5 PASS; новые точные network assertions дали RED 2/2 до правки |
| Тексты/видимые IDs | Восемь scoped browser flows: clipboard между аккаунтами/командой, create fail/success, profile nickname/retry, partial metadata retry, TEAM library metadata, concise invitations/roster light/dark/width | 8/8 PASS |
| Общие frontend проверки | Все unit/contract в финальном прогоне перед дополнительным stream-interruption сценарием | 108/108 PASS |
| Дополнительный обрыв XLSX | Текущие `apiErrorFeedback` + `exportDownloads`, включая Response stream failure и неизменный AbortError | 9/9 PASS; stream failure сначала показывал сырой Failed to fetch (RED) |
| Компиляция | TypeScript и production build после окончательных source edits | PASS; остаются обычные предупреждения размера существующих bundles/fonts |
| Независимый обзор | scoped security/reliability, повторная проверка cancel/export/status/code | approve; обязательных замечаний нет |

Подтверждённое дополнительное исправление: Ant Design Modal кеширует скрытых
детей. Простого условного отображения селектора оказалось недостаточно.
`destroyOnHidden` в RoomInterviewPanel прекращает pending preview при закрытии;
браузерная проверка наблюдает реальный AbortSignal до deadline и чистое повторное
открытие. RED снят на прежнем поведении в отдельной копии. Первое root browser
исполнение имело один HMR interruption при параллельных изменениях frontend;
окончательная immutable production проверка прошла 5/5.

Тестовые backend classes/schema/порты изолированы от development runtime;
фикстуры не создавались в пользовательской базе. Auth temporary report был
прочитан до удаления копии: `mvn -q -Dtest=AuthCredentialPolicyIntegrationTest test`,
Tests run 3, Failures 0, Errors 0, Skipped 0. Full backend suite и глобальная
продуктовая приёмка этим прогоном не заявлены.

## Локальный запуск

Frontend и backend полностью перезапущены после проверок; прежние настройки
и ключи чата/приглашений использованы повторно. Development PostgreSQL, аккаунты
и данные сохранены. `/api/public/health` → 200 `{status: ok}`, frontend и HTML
маршруты → 200. Реальный in-app browser открыл личный список и обновлённый
профиль с ником и копированием; ранее сохранённая сессия работает после restart.
Новые listeners: API 8080, frontend 5173. Откройте <http://localhost:5173>.

