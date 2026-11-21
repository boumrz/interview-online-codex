# Самостоятельная выкладка обучения, курсоров и входа Google/GitHub

Историческая инструкция для выпуска с двумя провайдерами. Действующее подключение GitHub и обновление приложения описаны в [инструкции выкладки](../../DEPLOY_INTERHUB_RU.md).

Обычный deploy включает общий маршрут обучения, доску и редактор диаграмм. Google и GitHub появляются на странице входа после передачи пары ID и секрета каждого клиента в backend. Владелец выполняет выкладку и живую проверку. [UI.3](../features/ui-3-interactive-learning.md) · [AUTH.1](../features/auth-1-social-login.md) · [Основная инструкция сервера](../../docs/deployment/VTOLS_DEPLOYMENT_RUNBOOK_RU.md)

## 1. Подготовленные данные

| Назначение | Значение |
| --- | --- |
| Публичный origin | `https://interview.vtools.tech` |
| Google project | `seraphic-plexus-515017-m7` |
| GitHub OAuth App | `4029964` |
| Production callback Google | `https://interview.vtools.tech/api/auth/social/google/callback` |
| Production callback GitHub | `https://interview.vtools.tech/api/auth/social/github/callback` |
| Приватный файл владельца | `/Users/romanzheltov/.config/interhub/deploy/social-auth-production.env` |
| Счётчик Метрики | `109032539`, [дашборд обучения](https://metrika.yandex.ru/dashboard?id=109032539&dashboardId=5dfcdf23-fc25-4186-846f-21b958adb13f) |

Файл имеет права `600`, хранится вне Git и содержит обе пары OAuth, основной `PUBLIC_BASE_URL` и `SOCIAL_AUTH_FLOW_SECRET`. Перенести одноимённые настройки в существующий `/etc/interview-online/.env` через защищённый канал. При наличии действующего `SOCIAL_AUTH_FLOW_SECRET` сохранить его. Оставить исходные параметры других сервисов, ключи приглашений и базы. Правами на файл и доступом администраторов сервера управляет владелец выкладки. [Рекомендации Google по хранению секретов](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)

Оба callback сохранены в настройках OAuth-клиентов по результату проверки 18 ноября. Локальные адреса используют `http://localhost:5173/api/auth/social/google/callback` и `http://localhost:5173/api/auth/social/github/callback`. Для другого публичного домена добавить точные адреса этого домена в кабинеты провайдеров и обновить `PUBLIC_BASE_URL`.

Google остаётся External / Testing. Для запроса `openid profile` Google разрешает вход в Testing даже аккаунтам вне списка тестировщиков. Экран может показывать статус Testing. Чтобы убрать тестовый режим, выбрать **Google Auth Platform → Audience → Publish app**. Страницы `/privacy` и `/terms` публикуются вместе с InterHub, ссылки сохранены в Branding. Верификация Branding нужна для отображения имени и логотипа приложения. При базовых разрешениях отдельной проверки доступа к данным не требуется. Изменения статуса в Google Console вступают в силу без повторной сборки InterHub. [Режимы Google OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) · [Google Branding](https://support.google.com/cloud/answer/15549049)

Проверка через Chrome 20 ноября подтвердила, что оба провайдера уже имеют отдельные callback для HTTPS и localhost, а в Google Branding сохранены ссылки на документы и домен. На действующем сервере оба URL документов отдают главную страницу, а `/api/auth/social/providers` отвечает пустым списком. До проверки Google Branding выложить рабочие публичные документы. Для запуска GitHub можно перенести только его пару ключей и общий ключ OAuth. Когда будет готов Google, добавить его пару в тот же защищённый файл окружения.

GitHub OAuth App позволяет пользователю авторизовать вход сразу после регистрации клиента и настройки callback. Одобрение организации относится к её собственным ресурсам. InterHub запрашивает только базовую идентификацию. [Регистрация и callback GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authenticating-to-the-rest-api-with-an-oauth-app) · [Авторизация пользователя GitHub](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps)

Чтобы подключить сервис к существующему аккаунту: войти привычным способом → открыть **Профиль → Способы входа** → нажать **«Подключить Google»** или **«Подключить GitHub»** → подтвердить выбранный аккаунт у провайдера. После возврата статус становится **«Привязан»**, данные и текущая сессия InterHub сохраняются. Это работает и для аккаунта без локального пароля. Существующая привязка через страницу входа («У меня есть аккаунт» → прежние ник/пароль) также остаётся доступной; создание нового профиля вместо привязки даст отдельный аккаунт.

Отвязка доступна в том же разделе. После подтверждения выбранная связь удаляется из InterHub. Проверьте, что пароль или другой включённый и привязанный провайдер открывает прежний профиль. Последний доступный способ защищён от отвязки. Если внешний аккаунт уже привязан к другому профилю InterHub, отвязку нужно подтвердить в том профиле.

Тёмные кнопки, отвязка и тур по интерфейсу поставляются обычной пересборкой web и backend. На запуске Flyway применяет V43–V46. На текущем коде достаточно обычного deploy с действующей конфигурацией.

## 2. Снимок перед обновлением

Выкладку выполняет владелец или администратор компании с доступом к Docker, checkout и защищённому `.env`. Ниже предполагаются текущие пути `/opt/interview-online/repo` и `/etc/interview-online/.env`. Использовать того же пользователя и проект Compose, что в текущей установке. Если нужны root-права, открыть привилегированную сессию целиком, чтобы резервные файлы тоже создавались с правильными правами.

```bash
set -euo pipefail
set +x
umask 077
cd /opt/interview-online/repo

INTERHUB_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
INTERHUB_RELEASE_BACKUP="/opt/interview-online/backups/auth-ui3-${INTERHUB_RELEASE_ID}"
mkdir -p "$INTERHUB_RELEASE_BACKUP"
chmod 700 "$INTERHUB_RELEASE_BACKUP"

INTERHUB_COMPOSE_ARGS=(-f /opt/interview-online/repo/docker-compose.prod.yml)
# Если текущая установка использует shared proxy, раскомментировать:
# INTERHUB_COMPOSE_ARGS+=(-f /opt/interview-online/repo/docker-compose.shared-proxy.yml)
compose() {
  docker compose "${INTERHUB_COMPOSE_ARGS[@]}" --env-file /etc/interview-online/.env "$@"
}

git rev-parse HEAD > "$INTERHUB_RELEASE_BACKUP/previous-commit.txt"
cp /etc/interview-online/.env "$INTERHUB_RELEASE_BACKUP/server.env"
chmod 600 "$INTERHUB_RELEASE_BACKUP/server.env"
compose ps
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$INTERHUB_RELEASE_BACKUP/postgres.dump"
test -s "$INTERHUB_RELEASE_BACKUP/postgres.dump"
compose exec -T postgres pg_restore --list < "$INTERHUB_RELEASE_BACKUP/postgres.dump" > "$INTERHUB_RELEASE_BACKUP/postgres-contents.txt"

INTERHUB_OLD_BACKEND="$(docker inspect --format '{{.Image}}' "$(compose ps -q backend)")"
INTERHUB_OLD_WEB="$(docker inspect --format '{{.Image}}' "$(compose ps -q web)")"
docker image tag "$INTERHUB_OLD_BACKEND" "interhub-backend:before-auth-ui3-${INTERHUB_RELEASE_ID}"
docker image tag "$INTERHUB_OLD_WEB" "interhub-web:before-auth-ui3-${INTERHUB_RELEASE_ID}"
docker image save "interhub-backend:before-auth-ui3-${INTERHUB_RELEASE_ID}" "interhub-web:before-auth-ui3-${INTERHUB_RELEASE_ID}" > "$INTERHUB_RELEASE_BACKUP/application-images.tar"

cat > "$INTERHUB_RELEASE_BACKUP/rollback-images.yml" <<EOF
services:
  backend:
    image: interhub-backend:before-auth-ui3-${INTERHUB_RELEASE_ID}
    pull_policy: never
  web:
    image: interhub-web:before-auth-ui3-${INTERHUB_RELEASE_ID}
    pull_policy: never
EOF
```

Проверка `pg_restore --list` подтверждает читаемость архива; полноценная проверка восстановления выполняется в отдельной БД по обычному регламенту владельца. Резервный каталог содержит приватные данные и секреты. Сохранить его путь и защищённую копию вне диска приложения. Сертификаты и PostgreSQL volume остаются на месте; эти команды не останавливают приложение.

## 3. Обновление кода и окружения

До этого шага нужный commit должен быть опубликован в согласованной ветке `main`. Проверить, что серверный checkout не содержит собственных незакоммиченных изменений; при их наличии сначала согласовать и сохранить их, не использовать `reset --hard`.

```bash
git status --short
git diff --quiet
git diff --cached --quiet
git fetch origin
git pull --ff-only origin main
git rev-parse HEAD
docker compose version
python3 --version
sudoedit /etc/interview-online/.env
```

Сверить напечатанный commit с публикуемым релизом. Для первой выкладки перенести `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_BASE_URL` и `SOCIAL_AUTH_FLOW_SECRET` из приватного файла, сохраняя действующий ключ OAuth при его наличии. Для Google оставить пару пустой до готовности публичного входа. Полная пара `*_CLIENT_ID` и `*_CLIENT_SECRET` добавляет соответствующую кнопку, в том числе для клиента в Testing. При частичной паре сообщение перед сборкой назовёт недостающий ключ. Если есть внешний HTTP-прокси, проверить правила журналирования callback из раздела 5.

Сохранить прежние `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `CHAT_RECEIPT_HMAC_SECRET`, `TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID`, `TEAM_INVITATION_LINK_ENCRYPTION_KEY` и полный keyring при его ротации. Также сохранить `DOMAIN`, `INTERVIEW_SERVER_NAMES`, порты, `NGINX_SSL`, `COMPOSE_FILES`, настройки `FINANCE_*`/`SHARED_PROXY_NETWORK`, если они используются. `CORS_ORIGINS` должен включать основной HTTPS origin и другие действующие origins. Основа — [пример env](../../deploy/env/docker.env.example) и [Compose](../../docker-compose.prod.yml).

Если `SOCIAL_AUTH_FLOW_SECRET` ещё не выдавался и отсутствует, сгенерировать один раз в приватный файл, затем перенести значение в `.env` редактором; повторно при каждом deploy не генерировать:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > "$INTERHUB_RELEASE_BACKUP/social-auth-flow-secret.txt"
chmod 600 "$INTERHUB_RELEASE_BACKUP/social-auth-flow-secret.txt"
```

Для приложения не нужны `METRIKA_TOKEN`, OAuth-токен управления Метрикой или отдельный backend API key. Счётчик `109032539` и разрешённые домены уже включены в frontend. `localhost`/IP-адрес и случайный staging-домен не отправляют рабочие события. `VITE_METRIKA_ALLOWED_HOSTS` — сборочная настройка Rspack, в текущем production Compose она не передаётся build arg; простая запись нового хоста в серверный `.env` её не изменит.

## 4. Обычный deploy

```bash
bash /opt/interview-online/repo/deploy/scripts/deploy_docker.sh
compose ps
curl -fsS https://interview.vtools.tech/healthz
curl -fsS https://interview.vtools.tech/api/auth/social/providers
```

Открыть `/privacy` и `/terms` по HTTPS без входа. Убедиться, что браузер показывает сами документы: статус HTTP 200 возможен и при возврате главной страницы. После этого открыть Google Auth Platform, завершить нужные шаги в Branding и опубликовать приложение в Audience. Добавить `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` в тот же `.env` и повторно применить серверное окружение. Для финальной проверки открыть страницу входа в приватном окне и пройти вход обоими способами.

Flyway применяет добавочные миграции [V43](../../backend/src/main/resources/db/migration/V43__social_auth_room_return.sql), [V44](../../backend/src/main/resources/db/migration/V44__learning_progress.sql), [V45](../../backend/src/main/resources/db/migration/V45__social_auth_profile_link.sql) и [V46](../../backend/src/main/resources/db/migration/V46__learning_progress_versions.sql) при старте backend. После V46 каждый аккаунт получает чистый статус обучения версии 2. Старые отметки остаются в таблицах версии 1. Ответ `/providers` показывает, какие клиенты доступны в приложении. После запуска пройти вход через каждого провайдера в основном HTTPS-домене.

## 5. Прокси и ресурсы холстов

В [HTTP](../../frontend/nginx.docker.http.conf) и [HTTPS](../../frontend/nginx.docker.ssl.conf) nginx приложения есть отдельное правило для `/api/auth/social/(google|github|vk)/callback`: запрос с одноразовым кодом не записывается в access/error log. Если перед приложением есть отдельный HTTP ingress/CDN/nginx, его владелец должен применить такое же исключение к **обоим callback-путям**. Не включать `$request_uri`/query/body callback в журналы или трассировки. При чистом TCP/NAT-перенаправлении дополнительного HTTP access log нет. HTTPS должен завершаться корректно, без переписывания host/callback на legacy-домен. Начинать social smoke на основном HTTPS-адресе.

```bash
compose exec -T web nginx -t
```

Курсоры не имеют отдельного feature flag и новой миграции: они поставляются вместе с обновлёнными frontend/backend, работают по SSE + POST и доступны на включённых холстах. На внешнем HTTP-прокси сохранить `proxy_buffering off`, отключение cache и длительный read timeout для `/api/realtime/`, как в nginx приложения. Обновлённые клиенты должны перезагрузить вкладки после выкладки.

draw.io закреплён в [drawio-release.json](../../frontend/scripts/drawio-release.json): версия `32.6.10`, архив `draw.war`, SHA-256 `a57b06b3b6a876a351dacfe65d027d9509319cd030e9bacf6ae04a034d66a38f`. Скрипт загружает/проверяет его на хосте до сборки и использует кэш `frontend/.cache/drawio/32.6.10/draw.war`. При закрытом доступе сервера к GitHub перенести этот проверенный архив вручную и указать путь к уже существующему файлу:

```bash
DRAWIO_ARCHIVE_PATH=/path/on/server/drawio-32.6.10.war bash /opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

Frontend Docker build также требует npm/Docker-зависимости; архив решает только загрузку draw.io. Белая доска использует локальные ресурсы Excalidraw. Deploy проверяет JS, worker и font-manifest, поэтому SPA HTML вместо asset считается ошибкой. Подготовка архива с компьютера владельца описана в [существующем runbook](../../docs/deployment/REDEPLOY_BOTH_SERVERS_RU.md#архив-редактора-и-сборка-без-доступа-к-github).

## 6. Проверки обучения и входа

| Проверка владельца | Критерий |
| --- | --- |
| Google и GitHub: первый вход, отмена, повторный вход | Нормальный экран провайдера, исправимый ник/имя; повторный вход открывает тот же аккаунт; отмена оставляет обычный вход доступным |
| Подключение из профиля | Войти прежним способом, открыть «Способы входа» и поочерёдно подключить провайдеры: статусы сохраняются после перезагрузки, ID/сессия/комнаты/команды не меняются. Повторить добавление второго провайдера для аккаунта без локального пароля. Отмена и занятая чужим аккаунтом связь не меняют пользователя. Старый путь «У меня есть аккаунт» на экране входа продолжает работать |
| Отвязка и оформление | В обеих темах проверены кнопки провайдеров. Отвязать один способ в профиле с альтернативой, обновить страницу, войти оставшимся способом и получить прежний профиль. Проверить отказ для последнего способа. |
| Вход из комнаты кандидата | Добровольный вход возвращает в ту же доступную комнату; кандидат с аккаунтом не получает предложение обучения |
| Отзыв доступа / удалённая или архивированная комната | Возврат не раскрывает недоступную комнату, показывает безопасный отказ/кабинет; истёкшая OAuth-попытка предлагает начать заново |
| Обучение кабинета | Первое предложение объясняет маршрут и позволяет пропустить его целиком. Переходы по разделам и действия в формах продвигают маршрут. Подсказка в открытой форме находится над полями. После нового входа пропуск и прогресс сохранены. |
| Обучение комнаты интервьюера | «?» открывает тур текущей комнаты. Реальные вкладки, смена режима и возврат из полноэкранного вида ведут по шагам. Открытие формы результата завершает тур, публикация результата остаётся отдельным действием. |
| Повтор и кандидат | Завершение доступно для повтора через помощь; кандидат не видит обучение даже после прежнего обучения в роли интервьюера |
| Курсоры двумя браузерами | Видны перекрестие, имя и цвет друг друга на одной диаграмме и доске, совпадает позиция при разных zoom/pan, есть указатель за границей экрана; приватный шаг интервьюера не виден кандидату |
| Уход/переподключение | Уход с холста/из комнаты убирает маркер, обновление вкладки возвращает только актуальные; readonly-участник передаёт положение без возможности изменить рисунок |
| Метрика | После реальных контрольных действий появляются соответствующие `learn_*_v1`; параметры `learning_attempt`, `learning_source`, `learning_module` корректны, повтор не смешан с первым прохождением |

Для Метрики открыть [дашборд](https://metrika.yandex.ru/dashboard?id=109032539&dashboardId=5dfcdf23-fc25-4186-846f-21b958adb13f) и сверить данные после обработки сервисом. Для smoke использовать браузер без блокировки счётчика и учесть настройку «Не учитывать мои визиты». Контрольные проходы становятся настоящими данными счётчика — выбрать известное окно проверки. Не вызывать цели вручную из консоли и не создавать фиктивные прохождения для заполнения дашборда. D7 нельзя подтвердить немедленным завершением: зрелость когорты и оставшиеся visitor-сегменты описаны в [отчёте настройки](2026-11-17-learning-metrika-setup.md).

## 7. Откат с сохранением БД

Если один провайдер временно недоступен, убрать из серверной конфигурации его пару ID и секрета и применить окружение через обычный deploy. Записи привязок сохраняются. Учесть пользователей, у которых этот провайдер был единственным способом входа. Для отката сборки обучения или ресурсов холстов использовать предыдущую пару образов.

**Откат образов при регрессии кода:** использовать пару образов, сохранённых до релиза, и прежний `.env`. Команды ниже требуют ранее сохранённый путь `INTERHUB_RELEASE_BACKUP` и тот же список `INTERHUB_COMPOSE_ARGS`. Если открыта новая shell-сессия, восстановить их из шагов 2 и фактического пути резервной копии.

```bash
cp /etc/interview-online/.env "$INTERHUB_RELEASE_BACKUP/server-before-rollback.env"
chmod 600 "$INTERHUB_RELEASE_BACKUP/server-before-rollback.env"
cp "$INTERHUB_RELEASE_BACKUP/server.env" /etc/interview-online/.env
docker image load < "$INTERHUB_RELEASE_BACKUP/application-images.tar"
docker compose "${INTERHUB_COMPOSE_ARGS[@]}" -f "$INTERHUB_RELEASE_BACKUP/rollback-images.yml" --env-file /etc/interview-online/.env config --quiet
docker compose "${INTERHUB_COMPOSE_ARGS[@]}" -f "$INTERHUB_RELEASE_BACKUP/rollback-images.yml" --env-file /etc/interview-online/.env up -d --no-build --no-deps backend web
compose ps
curl -fsS https://interview.vtools.tech/healthz
```

V43–V46 являются добавочными миграциями; автоматического SQL down migration нет. При откате сохраняются существующая БД, её migration history и PostgreSQL volume. Совместимость конкретного предыдущего образа с этой схемой проверить в резервной среде владельца до выпуска. Если прежний backend отказывается стартовать из-за проверки схемы/Flyway, вернуть текущую пару образов; не удалять V43–V46 из истории и не выполнять `repair` ради обхода проверки.

В обычном rollback **не выполнять** `docker compose down -v`, `docker volume rm`, очистку БД или восстановление старого дампа поверх рабочей БД. Дамп нужен для аварийного восстановления по отдельному плану владельца: такое восстановление может потерять записи после backup. Если возникла ошибка только сборки до `compose up`, действующие контейнеры обычно продолжают обслуживать старую версию; сначала проверить `compose ps`, не останавливать PostgreSQL.

## Проверка этой инструкции

Проверки 20 ноября 2026 года подтвердили подготовку архива и проверку ресурсов обоих холстов при обычном deploy, сохранность существующего env и проверку OAuth-конфигурации до сборки. Живой вход на сервере остаётся частью проверки владельца после выкладки.
