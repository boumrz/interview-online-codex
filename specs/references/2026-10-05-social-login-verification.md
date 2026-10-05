# Проверка Google/VK входа — 2026-10-05

Контракт: [AUTH.1](../features/auth-1-social-login.md).
Подключение внешних приложений: [инструкция](2026-10-05-social-login-setup.md).

Это отчёт о подготовленной интеграции до решения отложить подключение.
Текущее состояние — отключённая заготовка с общим
`FEATURE_SOCIAL_AUTH_ENABLED=false`; см. [проверку отключения](2026-10-05-social-login-deferred.md).
Ключи и флаги провайдеров сами по себе её не включают.

## Выполненный объём

Реализованы серверный Google OpenID Connect и конфиденциальный VK ID code
flow с PKCE; кнопки появляются только для настроенных включённых провайдеров.
Первый вход завершает регистрацию ником и именем без локального пароля.
Существующий локальный аккаунт привязывается только после явного подтверждения
его credentials. Email, ник и имя провайдера не объединяют пользователей.
Обычный вход и старые кириллические credentials сохранены.

Токены провайдеров не сохраняются. Cookie proof и state хешированы в БД;
PKCE verifier/Google nonce выводятся из отдельного серверного HMAC-секрета.
Проверяются Google подпись/issuer/audience/azp/expiry/nonce и VK state/user_id
по серверным ответам. Callback и Origin ограничены одним настроенным origin.
HTTPS использует host-only `__Host-` cookie. Callback/complete одноразовые,
гонки защищены транзакциями и уникальностью provider/subject.

V34 допускает отсутствие локального password_hash, добавляет provider identities
и временные flow records. Существующие IDs и данные сохраняются; удаление
пользователя удаляет его provider identities через FK cascade.

## Свежие результаты

| Приёмка | Проверка | Результат |
| --- | --- | --- |
| AC-01, AC-05, AC-06 | `frontend/tests/e2e/account/e2e-social-login.mjs`, production immutable preview | **12/12 PASS** |
| AC-02, AC-03, AC-04 | `SocialAuthIntegrationTest` | **14/14 PASS**, PostgreSQL 16 + реальные локальные HTTP/JWKS ответы |
| AC-01, AC-02 | `SocialAuthConfigurationTest` | **4/4 PASS**, отдельные configuration tests без БД |
| AC-04 | `SocialAuthMigrationIntegrationTest` | **1/1 PASS**, реальная V33→V34 миграция PostgreSQL с кириллическими credentials и своей комнатой |
| AC-04 / UI.2 R-27 | `AuthCredentialPolicyIntegrationTest` | **3/3 PASS**, PostgreSQL |
| Сохранность локальной регистрации и входа | `e2e-auth-registration-policy.mjs` + `e2e-login-profile-hydration.mjs` | **11/11 PASS**, изолированный production browser run |
| Сборка и конфигурация | TypeScript typecheck, production Rspack build, Docker Compose `config --quiet` | **PASS** |
| Документация | Ссылки, fences, соответствие env names, `git diff --check` | **PASS** |

Итого backend **22/22**: 18 PostgreSQL проверок и 4 configuration проверки.
Browser **23/23**: 12 social сценариев и 11 проверок прежней авторизации.
Повторные запуски не прибавлены к числу различных проверок.

Backend запускал автор из временной копии, независимый проверяющий и root
прочитали актуальные Surefire XML. Root запустил browser suites и typecheck.
Подготовка E2E создаёт отдельную схему тестовой PostgreSQL БД и отдельные
процессы/порты; development БД и live backend/target не используются.

Команды:

```bash
# Backend — из изолированной копии, JDK 17, test PostgreSQL configuration
mvn -q -Dtest=SocialAuthConfigurationTest,SocialAuthIntegrationTest,SocialAuthMigrationIntegrationTest,AuthCredentialPolicyIntegrationTest test

# Frontend — подготовленные 12 social сценариев, только в изолированном runner
FEATURE_SOCIAL_AUTH_ENABLED=true E2E_PRODUCTION=true node tests/e2e/run-isolated.mjs tests/e2e/account/e2e-social-login.mjs

# Прежняя авторизация проверена в том же production runner до terminal recovery fix
E2E_PRODUCTION=true node tests/e2e/run-isolated.mjs tests/e2e/account/e2e-auth-registration-policy.mjs tests/e2e/account/e2e-login-profile-hydration.mjs
npm run typecheck
```

Локальное evidence в игнорируемой `.run/`:
`social-auth-evidence/backend/TEST-*.xml`, `social-auth-backend-green.log`,
`social-auth-browser-complete.log`, `social-auth-browser-final.log`.

## RED и независимый обзор

Перед backend реализацией 11 исходных HTTP сценариев отказали из-за отсутствующих
endpoint; перед frontend реализацией 8 сценариев отказали из-за отсутствующих
кнопок/нового маршрута. Ошибки настройки и сборки не считались RED.

Независимый review обнаружил и подтвердил:

1. JDK 17 `HttpRequest.timeout` ограничивал только заголовки. Добавлен
   deadline всей async response future и ограничение тела 64 KiB; настоящий
   задержанный HTTP body теперь отказал до deadline. Для backend HTTPS
   дополнительно подтверждён защищённый `__Host-` cookie.
2. После pagehide сохранялся busy state. Два браузерных сценария подтвердили
   отказ, затем исправление: start и complete/pending GET отменяются,
   форма возвращает доступный вход заново, поздний ответ не создаёт сессию.
3. После network error профиля и последующего 401 сохранялся режим retry
   уже потреблённого complete. Отдельный сценарий подтвердил RED, затем GREEN:
   терминальная потеря сессии очищает временный token/retry и предлагает
   новый вход. Скрытый pending GET также не запускает автоматический complete.

Итог independent scoped review: **security pass, reliability pass-with-notes,
approve; обязательных открытых исправлений нет**. Notes — внешние проверки ниже.

## Что ещё требует владельца

- Создать Google Web client и конфиденциальное VK Web приложение, получить
  реальные ключи, зарегистрировать точные callbacks и разрешить VK egress IP.
- Для VK localhost использовать 80/443 или HTTPS tunnel; 5173 прямо не поддержан.
- Выполнить живой smoke по инструкции перед публичным включением.
- Проверить работу Nginx в целевой среде: шаблоны и Compose проверены, но Nginx
  runtime здесь не запускался. Callback access/error logging в штатных HTTP/HTTPS
  шаблонах выключено; собственные proxy/APM должны сохранять эту границу.

Оба провайдера остаются выключенными по умолчанию. В текущей рабочей копии
подготовлен `.run/social-auth.local.env` (0600, Git ignored) с отдельным
случайным flow secret и пустыми внешними credentials; содержимое не выводилось.
При будущем явном возобновлении интеграции пользователь следует инструкции,
включая общий флаг на обеих сторонах. Работающие пользовательские процессы в рамках этой задачи
не перезапускались; V34 в development БД ещё не применялась.

Живой provider login, production deployment, полный backend suite и отдельная
Gradle сборка не заявляются проверенными. Browser tests изолируют провайдерские
API ответы; backend tests проверяют настоящие HTTP transport и криптографию.
Email recovery, чтение почты, отвязка провайдеров и добавление локального
пароля для social-only аккаунта в этот объём не входят.
