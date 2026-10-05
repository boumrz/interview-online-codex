# Google и VK ID — отложенное подключение

**Статус: отложено по решению пользователя.** Заготовка сохранена, вход через
Google/VK выключен. Существующие пользователи продолжают входить по нику и
паролю. Следующие шаги нужны только при будущем возобновлении подключения;
сейчас создавать внешние приложения и заполнять ключи не требуется.

Исследование проверено по официальным документам 5 октября 2026 года.
Перед будущим включением нужно повторно сверить требования провайдеров.
Текущий контракт: [AUTH.1](../features/auth-1-social-login.md). Реальные ключи,
публикация приложений и вход живыми аккаунтами требуют действий владельца
в внешних кабинетах.

«Gmail» в этом подключении означает аккаунт Google. Приложение не получает
доступ к письмам, не отправляет почту и не добавляет восстановление локального
пароля. Существующий вход по нику и паролю остаётся доступен.

## Где сохранена заготовка и как вернуться к ней

- Контракт и состояние работ: [AUTH.1](../features/auth-1-social-login.md).
- Backend: [features/socialauth](../../backend/src/main/kotlin/com/interviewonline/features/socialauth/SocialAuthConfiguration.kt)
  — конфигурация, контроллер, обмен с провайдерами, попытки и связи аккаунтов.
- Кнопки frontend: [SocialLoginButtons](../../frontend/src/features/auth/SocialLoginButtons.tsx).
- Страница завершения входа: [SocialLoginPage](../../frontend/src/pages/SocialLoginPage.tsx).
- Клиент запросов: [socialAuth](../../frontend/src/services/socialAuth.ts).
- Переменные: [шаблон окружения](../../deploy/env/docker.env.example),
  [Docker Compose](../../docker-compose.prod.yml) и
  [конфигурация сборки frontend](../../frontend/rspack.config.mjs).

Общий выключатель — **`FEATURE_SOCIAL_AUTH_ENABLED=false` по умолчанию**.
Он действует и на backend, и на frontend. Флаги отдельных провайдеров и
credentials сами по себе функцию не включают.

При будущем возобновлении сначала выполнить подготовку из этой инструкции
и проверки из контракта, затем явно задать `FEATURE_SOCIAL_AUTH_ENABLED=true`
на backend и при сборке frontend. Backend необходимо перезапустить;
frontend — пересобрать, а локальный dev server — перезапустить с этим флагом.
Изменение только окружения уже собранного frontend кнопки не активирует.

## 1. Выбрать один адрес приложения

`PUBLIC_BASE_URL` — публичный **origin**, без пути, query и завершающего `/`.
Браузер открывает приложение по этому же адресу. Frontend и `/api` доступны
на одном origin; `/api` проксируется к backend. Backend строит оба callback
самостоятельно, не принимает адрес возврата от браузера и не использует Host
для выбора адреса. Пример:

```text
PUBLIC_BASE_URL=https://interview.vtools.tech
Google callback=https://interview.vtools.tech/api/auth/social/google/callback
VK callback=https://interview.vtools.tech/api/auth/social/vk/callback
```

| Среда | PUBLIC_BASE_URL | Что настроить |
| --- | --- | --- |
| Google локально | `http://localhost:5173` | Этот Google callback с портом 5173 |
| Google и VK через локальный reverse proxy | `http://localhost` | Proxy на порту 80 к frontend 5173; callbacks без номера порта |
| Google и VK через HTTPS-туннель | `https://<ваш-стабильный-домен>` | Туннель к frontend с `/api`, оба callbacks на его домене |
| Production | `https://interview.vtools.tech` | HTTPS, зарегистрированные callbacks, proxy `/api` |
| Отдельный production инстанс | `https://interview.domiknote.ru` | Своя конфигурация PUBLIC_BASE_URL и зарегистрированные callbacks |

Для Google URI должен совпадать с записью в кабинете посимвольно, включая
схему, порт, путь и завершающий слеш. В production нужен HTTPS; localhost и
loopback допускают HTTP. [Требования Google к redirect URI](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

У VK сейчас есть отдельное ограничение: локальная проверка поддерживается
на `http://localhost:80` либо `https://localhost:443`; в настройках указываются
`localhost` и redirect без явного номера порта. Другие локальные порты пока
не поддерживаются. Поэтому `http://localhost:5173` подходит для Google, а для
VK нужен proxy на 80/443 или HTTPS-туннель. Точный callback с путём из таблицы
нужно сохранить в кабинете, а не только корень сайта.
[Официальная настройка VK, раздел о локальной проверке](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application).

При использовании туннеля:

1. Назначьте стабильный HTTPS-адрес и настройте передачу всех путей к локальному
   frontend. Для текущего dev server upstream Host должен быть разрешённым
   локальным Host; это настройка туннеля/proxy, не повод отключать проверки Host.
2. Проверьте по этому адресу `/login` и `/api/public/health`.
3. Установите PUBLIC_BASE_URL на адрес туннеля, добавьте этот origin к текущему
   CORS_ORIGINS и зарегистрируйте оба callbacks с этим адресом.
4. Начинайте вход в браузере на адресе туннеля. Cookie с localhost на него
   не переносится. Если адрес туннеля сменился, обновите все три настройки.

## 2. Создать приложение Google

1. Откройте [Google Cloud Console](https://console.cloud.google.com/), создайте
   или выберите проект, затем **Google Auth Platform → Branding**.
2. Укажите название InterHub, адрес поддержки, контакт разработчика. Для
   публикации подготовьте собственные страницы приложения и политики
   конфиденциальности, добавьте принадлежащие вам домены.
3. В **Audience** выберите **External**, если вход предназначен и для обычных
   Google/Gmail аккаунтов. **Internal** ограничивает вход вашей организацией
   Google Workspace.
4. В **Data Access** оставьте только базовую идентификацию `openid` и
   `profile`: именно их запрашивает приложение. Gmail, Drive и другие
   разрешения здесь не нужны; email не требуется для входа.
5. В **Clients → Create client** выберите тип **Web application**. Добавьте
   нужные строки из таблицы ниже в **Authorized redirect URIs**.
6. Сохраните **Client ID** и **Client secret** в серверной конфигурации.
   Secret нужно сохранить при создании: Google больше не показывает и
   не предлагает скачать его повторно. Для утраченного секрета используйте
   управление секретами в кабинете.

[Настройка consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent),
[создание Web client и Branding](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[сохранение и смена Client secret](https://support.google.com/cloud/answer/15549257).

| Среда | Google Authorized redirect URI |
| --- | --- |
| Локальный frontend | `http://localhost:5173/api/auth/social/google/callback` |
| Локальный proxy на 80 | `http://localhost/api/auth/social/google/callback` |
| Production | `https://interview.vtools.tech/api/auth/social/google/callback` |
| Второй инстанс | `https://interview.domiknote.ru/api/auth/social/google/callback` |
| HTTPS-туннель | `https://<ваш-стабильный-домен>/api/auth/social/google/callback` |

Отдельные clients для development и production упрощают ограничение
доступа к ключам. В этой реализации используется серверный redirect flow:
Google JavaScript SDK устанавливать не нужно. Поле **Authorized JavaScript
origins** не заменяет **Authorized redirect URIs**.
Изменения client-настроек Google могут вступать в силу от нескольких минут
до нескольких часов; при точном совпадении новых URI дайте им время
примениться. [Управление OAuth clients](https://support.google.com/cloud/answer/15549257).

Для контрольного запуска добавьте свои аккаунты в Audience → Test users.
При Testing Google обычно ограничивает доступ списком тестеров, но для
набора только базовых `openid/email/profile` действует исключение. Это не отменяет
ограничений администратора Workspace. Перед публичным запуском проверьте
Audience/Publishing status и Verification Center: отображение названия и
логотипа связано с проверкой бренда; необходимость проверки отражается
в кабинете. [Актуальные состояния Google OAuth приложений](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

## 3. Создать конфиденциальное Web приложение VK ID

1. Откройте [кабинет VK ID](https://id.vk.ru/business/go), войдите через
   VK Бизнес ID и создайте профиль бизнеса.
2. **Мои приложения → Добавить приложение**: название InterHub, платформа
   **Web**, изображение приложения.
3. Укажите базовый домен без пути и доверенный redirect URL — например,
   `interview.vtools.tech` и
   `https://interview.vtools.tech/api/auth/social/vk/callback`.
4. В **Ключи доступа** установите **Уровень конфиденциальности →
   Конфиденциальное**. В **IP-адрес сервера** разрешите внешний исходящий IP
   backend. При нескольких серверах добавьте каждый исходящий IP.
5. Сохраните ID приложения в `VK_CLIENT_ID`, **Сервисный ключ доступа** —
   в `VK_SERVICE_TOKEN`. Защищённый ключ `client_secret` — другое поле;
   данная интеграция его не использует.
6. Проверьте, что приложение включено. Оставьте минимальный доступ
   `vkid.personal_info`; email и phone для входа не требуются.

Публичный тип относится к обмену токенов на frontend. Для используемого
здесь серверного обмена инструкция VK требует конфиденциальный тип,
разрешённый IP и `service_token`.
[Создание и параметры VK приложения](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application#Konfidencialnoe-prilozhenie),
[Web flow с обменом на backend](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/start-integration/how-auth-works/auth-flow-web).

Для локальной проверки через туннель разрешается **исходящий IP локального
сервера**, обычно IP домашней/рабочей сети. Домен туннеля определяет входящий
callback, но не меняет исходящий IP запросов к VK. Если IP динамический,
обновите настройку при его смене. Не добавляйте без необходимости широкую
маску сети. VK отклоняет обмен с адреса вне разрешённого списка.

Профиль бизнеса требует подтверждения владельцем. По текущим правилам
новые профили должны пройти его в течение 60 дней после создания первого
приложения, иначе приложения блокируются. Для старых профилей до 15 декабря
2025 года срок был 1 марта 2026 года; при блокировке сначала завершите
подтверждение. Доступ к настройкам/ключам может зависеть от статуса проверки.
Это внешняя процедура, автоматические тесты приложения её не выполняют.
[Верификация VK Бизнес ID](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/verification).

## 4. Параметры для будущего включения

| Переменная | Значение и назначение |
| --- | --- |
| `FEATURE_SOCIAL_AUTH_ENABLED` | Общий флаг, `false` по умолчанию. Для будущего включения нужен `true` на backend и при сборке frontend/старте dev server |
| `PUBLIC_BASE_URL` | Один публичный origin. По умолчанию `http://localhost:5173` |
| `SOCIAL_AUTH_FLOW_SECRET` | Отдельный случайный секрет: 32 байта, Base64URL без padding; один и тот же во всех репликах |
| `GOOGLE_AUTH_ENABLED` | `false` по умолчанию; `true` после заполнения Google параметров |
| `GOOGLE_CLIENT_ID` | ID Google Web client |
| `GOOGLE_CLIENT_SECRET` | Серверный секрет Google Web client |
| `VK_AUTH_ENABLED` | `false` по умолчанию; `true` после настройки конфиденциального VK приложения |
| `VK_CLIENT_ID` | ID Web приложения VK ID |
| `VK_SERVICE_TOKEN` | Сервисный ключ конфиденциального VK приложения |
| `CORS_ORIGINS` | Сохранить существующие нужные origins и добавить выбранный public origin |

Секреты не помещаются в frontend, `VITE_*`, сборку, Git, скриншоты и сообщения.
Client ID публичен по протоколу, но не нужен в интерфейсе приложения.
Не заменяйте существующие ключи чата и приглашений этим секретом.
SOCIAL_AUTH_FLOW_SECRET сохраняется между перезапусками: его смена прерывает
незавершённые попытки входа. Уже созданная связь аккаунта хранится в БД.

При общем флаге `false` кнопки и social flow выключены, даже если provider
flags и credentials уже заполнены. Только после явного общего включения
настроенный провайдер становится доступен. При общем `true` и
`*_AUTH_ENABLED=true` неполная конфигурация вызывает понятную ошибку запуска
без публикации секретов. Если нет доступа к кабинету, ключам, подтверждению
бизнеса или разрешённому IP, оставьте этот provider flag `false`.

### Локальная конфигурация

В корне репозитория можно создать приватный файл в уже игнорируемой `.run/`.
Следующая команда генерирует новый секрет сразу в файл и не выводит его.
Она откажется перезаписывать уже существующий файл:

```bash
python3 - <<'PY'
import os
from pathlib import Path
import secrets

path = Path('.run/social-auth.local.env')
path.parent.mkdir(exist_ok=True)
content = (
    "FEATURE_SOCIAL_AUTH_ENABLED=false\n"
    "PUBLIC_BASE_URL='http://localhost:5173'\n"
    "SOCIAL_AUTH_FLOW_SECRET='" + secrets.token_urlsafe(32) + "'\n"
    "GOOGLE_AUTH_ENABLED=false\n"
    "GOOGLE_CLIENT_ID=''\n"
    "GOOGLE_CLIENT_SECRET=''\n"
    "VK_AUTH_ENABLED=false\n"
    "VK_CLIENT_ID=''\n"
    "VK_SERVICE_TOKEN=''\n"
)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(content)
PY
```

При будущем подключении откройте этот файл локальным редактором, внесите
параметры из кабинетов и включите готовые провайдеры. После необходимых
проверок явно измените общий FEATURE_SOCIAL_AUTH_ENABLED на `true`.
Убедитесь, что обычная конфигурация PostgreSQL,
чата и приглашений уже загружена так же, как при текущем запуске. Затем
передайте новые переменные процессам:

```bash
set +x
set -a
source .run/social-auth.local.env
set +a
./scripts/dev-up.sh --stop
./scripts/dev-up.sh
```

Запускной скрипт наследует эти переменные; самостоятельно этот файл он
не читает. Для VK сначала поднимите proxy или туннель из раздела 1 и
измените PUBLIC_BASE_URL/CORS_ORIGINS. При ручном запуске backend загрузите
тот же файл в его терминале. При перезапуске из другой оболочки переменные
нужно загрузить снова.

### Production

Сохраните параметры в уже используемом `/etc/interview-online/.env` на каждом
сервере, ограничьте доступ к файлу (`chmod 600`, владелец — администратор
деплоя). Копируйте имена переменных из
[шаблона окружения](../../deploy/env/docker.env.example), сохраняя текущие
значения БД, чата и шифрования приглашений.

Для production задайте HTTPS origin конкретного инстанса и разрешённый
исходящий IP этого backend в VK. Изменения переменных требуют пересоздания
backend контейнера; общий флаг также должен попасть в новую сборку frontend.
Штатный вариант из каталога `/opt/interview-online/repo`:

```bash
sudo ENV_FILE=/etc/interview-online/.env bash deploy/scripts/deploy_docker.sh
```

[Docker Compose](../../docker-compose.prod.yml) передаёт social-параметры
backend; [скрипт деплоя](../../deploy/scripts/deploy_docker.sh) читает внешний
файл окружения. Для нескольких реплик одного приложения используйте общий
SOCIAL_AUTH_FLOW_SECRET и согласованные provider credentials.

Callback содержит краткоживущий код в query. В штатных nginx шаблонах
логирование callback отключено; при собственном reverse proxy также
исключите query этих двух путей из access/error logs, APM и аналитики.
Не сохраняйте полные ответы token endpoint при диагностике.

## 5. При будущем включении проверить живыми аккаунтами

1. Откройте выбранный public origin в обычном браузере. Проверьте
   `/api/auth/social/providers`: он должен перечислять только включённые
   настроенные провайдеры. На форме входа видны соответствующие кнопки.
2. Войдите новым Google/VK аккаунтом. После возврата выберите уникальный
   ник и имя; при необходимости отметьте «Я нанимающий».
3. Выйдите и повторите вход тем же провайдером: должен открыться тот же
   аккаунт, без повторной регистрации и потери данных.
4. Другой проверенной личностью выберите «У меня есть аккаунт», введите
   ник/пароль существующего локального пользователя. Убедитесь, что
   сохранились его комнаты, задачи и права; затем проверьте оба способа входа.
5. Отмените вход у провайдера, проверьте неверный локальный пароль и занятый
   ник. Исправимые поля должны оставаться доступными.
6. Повторите старый callback, откройте его в другом браузере и начните вход
   заново после истечения 10 минут. Старые попытки не должны создавать
   аккаунт или новую связь.
7. Проверьте браузерное хранилище и адрес после возврата: provider tokens,
   code и state не сохраняются. Callback возвращает на `/login/social`; после
   успешной проверки профиля открывается личное пространство.

Совпадающий email **не привязывает** Google/VK к существующему пользователю.
Связь требует явного подтверждения его локального пароля. Аккаунт, созданный
только через провайдера, повторно входит через этого провайдера; локального
пароля и функции email recovery в этом объёме нет.

Автоматические проверки с локальными HTTP/JWKS провайдерами подтверждают
поведение приложения, но не доступность конкретного внешнего аккаунта,
корректность ключей из кабинета или прохождение модерации. Перед публичным
включением нужны независимый security/reliability review и этот живой smoke.

## 6. Если подключение не заработало

| Симптом | Проверка |
| --- | --- |
| Кнопки нет | Общий FEATURE_SOCIAL_AUTH_ENABLED на backend и в сборке frontend, флаг провайдера, переменные именно запущенного backend, ответ providers; после общего включения пересобрать frontend или перезапустить dev server и backend |
| Backend отказался запускаться | Полный комплект параметров включённого провайдера, формат SOCIAL_AUTH_FLOW_SECRET, корректный public origin |
| Google `redirect_uri_mismatch` | В кабинете именно этот Web client; точное совпадение PUBLIC_BASE_URL и callback, порт/слеш/схема |
| Google не пускает аккаунт | Audience Internal/External, Workspace admin policy, статус проекта/consent и тестовый аккаунт |
| VK отклоняет redirect | Домен/путь/схема в кабинете, порт localhost; 5173 напрямую не поддерживается |
| VK не обменивает код | Конфиденциальный тип, именно service token, исходящий IP сервера в разрешённом списке, состояние бизнес-профиля/приложения |
| После возврата попытка потеряна | Вход начат на том же origin и в том же браузере; cookie не удалена; прошло менее 10 минут; SOCIAL_AUTH_FLOW_SECRET согласован у реплик |
| Ошибка Origin | Браузер открывает PUBLIC_BASE_URL; туннель/proxy не меняет Origin; public origin входит в CORS_ORIGINS |
| Имя/почта отличаются от ожидаемых | Провайдерские поля могут меняться; email не нужен для идентификации или автоматической привязки |

В диагностике достаточно имени провайдера, времени, безопасного кода ошибки
и факта доступности HTTPS endpoint. Не пересылайте Client secret, service
token, flow cookie, callback query, access/refresh/ID tokens.

## Техническая памятка для сопровождения

### Google

Текущие endpoints взяты из
[официального OIDC discovery](https://accounts.google.com/.well-known/openid-configuration):

```text
authorization: https://accounts.google.com/o/oauth2/v2/auth
token:         https://oauth2.googleapis.com/token
userinfo:      https://openidconnect.googleapis.com/v1/userinfo
JWKS:          https://www.googleapis.com/oauth2/v3/certs
issuer:        https://accounts.google.com
```

Authorize: `response_type=code`, `client_id`, фиксированный `redirect_uri`,
`scope=openid profile`, случайные `state`/`nonce`, PKCE challenge
и `code_challenge_method=S256`. Token exchange — серверный HTTPS POST
`application/x-www-form-urlencoded` с `grant_type=authorization_code`,
`code`, `client_id`, `client_secret`, тем же `redirect_uri`, `code_verifier`.
[Google Web server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

ID token проверяется по доверенному JWKS: RS256, issuer, audience нашего
client, срок действия и nonce текущей попытки. Идентификатор — `sub`,
не email. `email_verified` не подтверждает право на уже существующий
локальный аккаунт. [Google OIDC reference](https://developers.google.com/identity/openid-connect/reference).

### VK ID

```text
authorization: https://id.vk.ru/authorize
token:         https://id.vk.ru/oauth2/auth
userinfo:      https://id.vk.ru/oauth2/user_info
```

Authorize: `response_type=code`, `client_id`, фиксированный `redirect_uri`,
случайный `state`, PKCE `code_challenge` и `code_challenge_method=S256`,
минимальный доступ `vkid.personal_info` по умолчанию при отсутствии scope.
Callback возвращает query
`code`, `state`, **`device_id`**. Token exchange — HTTPS POST form:
`grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`,
`client_id`, `device_id`, `state`, **`service_token`** для конфиденциального
приложения. Проверяется возвращённый state. Userinfo — HTTPS POST form
`client_id` + `access_token`; `user.user_id` сверяется с token `user_id`.
[Актуальный VK API](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description).

Текущий официальный SDK уже использует домен `id.vk.ru`; старые примеры
`oauth.vk.com`/старый Implicit Flow относятся к другой интеграции. Различие
SDK public exchange без секрета и confidential backend exchange важно:
нельзя исключить service_token, скопировав только браузерный SDK пример.
[Официальный SDK](https://github.com/VKCOM/vkid-web-sdk/blob/8ff76cfe59ea72e370c4c6c3b40712ecfd43aadd/src/auth/auth.ts).

VK ID token в этой интеграции не декодируется как доказательство личности.
Используются серверные token и user_info ответы. VK также публикует отдельное
описание проверки своего JWT с публичным ключом, но это не Google OIDC/JWKS
flow. [VK ID token](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/tokens/id-token).

### Защита попытки и ресурсы брендов

Наш сервер связывает state с одноразовой попыткой и HttpOnly cookie браузера,
проверяет Origin на изменяющих запросах, не принимает произвольный return
URL. PKCE verifier и Google nonce не передаются в frontend; провайдерские
токены используются только для проверки и не сохраняются. Эти правила
заданы [AUTH.1 R-02–R-07](../features/auth-1-social-login.md).

Google требует актуальный цветной G, поддерживает локализованную надпись
и собственную HTML-кнопку с соблюдением оформления. В текущем брендинге
используется Google Sans Medium. VK допускает фирменную синюю или белую
дополнительную кнопку; в тексте сохраняется пробел в «VK ID».
[Google branding](https://developers.google.com/identity/branding-guidelines),
[VK button rules](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/guidelines/design-rules).

Локальный VK mark в `frontend/public/auth/vk-id.svg` взят без изменения
геометрии из [официального VK SDK OneTap template](https://github.com/VKCOM/vkid-web-sdk/blob/8ff76cfe59ea72e370c4c6c3b40712ecfd43aadd/src/widgets/oneTap/template.ts).
Copyright © 2023 V Kontakte LLC, MIT; полная лицензия включена в SVG.
Google Sans распространяется по
[SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/googlesans/OFL.txt).
