# Отключённая заготовка Google/VK — 2026-10-05

Пользователь отложил внешнюю интеграцию. Код сохранён; пользовательский вход
остаётся по нику и паролю. Контракт: [AUTH.1 R-10/AC-07](../features/auth-1-social-login.md).
Будущее подключение: [инструкция](2026-10-05-social-login-setup.md).
Запись для следующей работы находится также в `AGENTS.md`, `SPEC.md` и README.

## Текущее поведение

- Общий `FEATURE_SOCIAL_AUTH_ENABLED=false` закрывает backend и frontend.
  Флаги провайдеров или их ключи сами по себе не включают сценарий.
- LoginPage не загружает social компонент, его стили, шрифт, изображения
  и список провайдеров. Прямой `/login/social` возвращает на обычный `/login`.
- Backend публикует пустой список; start/pending/complete/link запрещены
  до чтения временной попытки, проверки локального пароля или записи данных.
  Callback возвращает относительный `/login` без внешнего обмена.
- Выключенный модуль не читает неиспользуемые настройки провайдеров: даже
  неправильный тип timeout/provider flag не мешает запуску. Во включённом
  режиме ошибки конфигурации очищены от исходных значений.
- Неопределённый build constant безопасно даёт false у уже работающего
  dev server. Пользовательские процессы не перезапускались; миграция V34
  применялась только в изолированных проверках.

## Проверки

| Проверка | Результат |
| --- | --- |
| `SocialAuthDisabledIntegrationTest` | **6/6 PASS**, PostgreSQL: выключенный модуль, старые READY flows, callback, локальный вход |
| `SocialAuthConfigurationTest` | **8/8 PASS**, настройки и startup binding, включая неиспользуемые неверные типы |
| Подготовленная интеграция `SocialAuthIntegrationTest` | **14/14 PASS**, PostgreSQL и реальные локальные HTTP/JWKS ответы при явном включении в тесте |
| Миграция `SocialAuthMigrationIntegrationTest` | **1/1 PASS**, PostgreSQL V33→V34 |
| Старые credentials `AuthCredentialPolicyIntegrationTest` | **3/3 PASS**, PostgreSQL |
| `e2e-social-login-disabled.mjs` | **2/2 PASS**, изолированная production сборка: нет кнопок/запросов/assets, прямой return возвращает обычный login |
| Прежние registration policy, profile hydration, auth navigation | **12/12 PASS**, тот же изолированный production runner |
| TypeScript, production build, Compose config | **PASS** |
| Уже работающий localhost:5173 | **PASS**, отдельный headless browser: обычный login и dormant return, без page errors/social requests/assets; без отправки форм |
| Документация | Ссылки, fences, согласованность флага, whitespace **PASS** |

Итого **32 backend проверки** (24 PostgreSQL + 8 configuration),
**14 browser проверок**. Root и независимый reviewer прочитали актуальные
backend XML; root выполнил browser run и typecheck. Независимый scoped
security/reliability review не выявил блокирующих замечаний.

Перед gate реализацией подтверждены 7 backend поведенческих отказов и
2 browser отказа. Отдельный startup RED выявил ранний binding неверных
неиспользуемых значений; gate теперь проверяется до binding. Ошибки setup
не считались подтверждением отсутствующего поведения.

Воспроизведение из frontend:

```bash
FEATURE_SOCIAL_AUTH_ENABLED=false E2E_PRODUCTION=true node tests/e2e/run-isolated.mjs tests/e2e/account/e2e-social-login-disabled.mjs tests/e2e/account/e2e-auth-registration-policy.mjs tests/e2e/account/e2e-login-profile-hydration.mjs tests/e2e/account/e2e-auth-navigation.mjs
npm run typecheck
```

Backend запускался из временной копии на JDK 17 с отдельным PostgreSQL target:

```bash
mvn -q -Dtest=SocialAuthConfigurationTest,SocialAuthDisabledIntegrationTest,SocialAuthIntegrationTest,SocialAuthMigrationIntegrationTest,AuthCredentialPolicyIntegrationTest test
```

Локальное evidence, Git ignored: `.run/social-auth-disabled-red.log`,
`.run/social-auth-disabled-green.log`,
`.run/social-auth-deferred-evidence/backend/TEST-*.xml`,
`.run/social-auth-deferred-backend-green.log`.
Приватный `.run/social-auth.local.env` сохранён с false и правами 0600;
его значения не выводились.

## Возобновление

Текущее состояние технически проверено как отключённая заготовка.
Подключение провайдеров и продуктовая приёмка включённой интеграции отложены.
По новому запросу начать с AUTH.1 и инструкции; актуализировать внешние правила,
настроить кабинеты, включить общий флаг на backend и при сборке frontend,
проверить целевой proxy и живой вход. Старый
[отчёт реализации](2026-10-05-social-login-verification.md) сохраняет предыдущие
результаты и ограничения.
