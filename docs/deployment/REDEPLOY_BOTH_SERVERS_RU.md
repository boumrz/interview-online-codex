# Обновление (redeploy) на двух production-серверах

Ручной деплой: **git push** с локальной машины → **git pull** на каждом сервере → **`deploy_docker.sh`**.

CI/CD в проекте не используется.

## Что делает `deploy_docker.sh`

Скрипт `deploy/scripts/deploy_docker.sh` автоматически:

1. Проверяет постоянный ключ приглашений и конфигурацию Compose до изменения контейнеров
2. При включённых диаграммах проверяет/подготавливает закреплённый архив редактора, затем собирает Docker-образы (`backend`, `frontend` + nginx)
3. Поднимает стек из `docker-compose.prod.yml` (`postgres`, `backend`, `web`)
4. Ждёт health backend
5. Проверяет `http://127.0.0.1/healthz` и главную страницу
6. Если в `.env` включён SSL (`NGINX_SSL=true`) — проверяет `https://<DOMAIN>/`

Для первой активации редактора диаграмм и доски используйте
`deploy_docker.sh --enable-canvases`. После preflight эта опция делает приватный
backup существующего `.env` и сохраняет только
`FEATURE_ROOM_DIAGRAMS_ENABLED=true` и `FEATURE_ROOM_WHITEBOARD_ENABLED=true`.
Ключи, БД и остальные значения не заменяются примером. Frontend и backend
пересобираются вместе; одного restart недостаточно, потому что frontend flags
и native ресурсы фиксируются при сборке. Следующие обычные деплои сохраняют
включённое состояние. Без опции существующие настройки не переписываются.
Smoke дополнительно проверяет согласованность build/runtime flags и реальные
JS/worker/font ресурсы: ответ HTTP 200 с HTML вместо файла считается ошибкой.

Если код уже обновлён, а режимов нет, проверьте эти два значения в серверном
`.env`. Новые обычные элементы интерфейса могут быть видны одновременно с
отключёнными холстами — это не доказывает частичную загрузку Git-коммита.

### Архив редактора и сборка без доступа к GitHub

Ошибка `The operation was aborted due to timeout` на шаге
`prepare-drawio.mjs --if-enabled` означает, что загрузка draw.io не завершилась
за отведённое время. Она возникает после успешного TypeScript и до сборки приложения.
Новая версия `deploy_docker.sh` подготавливает архив на хосте до сборки и до
сохранения флагов в `.env`. Архив около 50 МБ проверяется по закреплённому SHA-256
и сохраняется в `frontend/.cache/drawio/32.6.10/draw.war`. Этот каталог входит в
контекст Docker, поэтому сборка использует проверенный файл без сети. Повторный
деплой использует тот же кэш. Генерируемый архив не хранится в Git.

Если сервер не может скачать релиз, подготовьте архив на локальном компьютере:

```bash
cd /path/to/interview-online-codex/frontend
node scripts/prepare-drawio.mjs --archive-only
scp .cache/drawio/32.6.10/draw.war romazh@10.2.2.2:/tmp/drawio-32.6.10.war
```

Дождитесь успешного завершения `scp` на локальном компьютере. Архив не находится
в Git и не появится на сервере после `git pull`; `DRAWIO_ARCHIVE_PATH` только
указывает путь к уже перенесённому файлу. Если адрес SSH отличается, используйте
тот же адрес сервера, через который открываете рабочую SSH-сессию.

На сервере сначала заберите опубликованные изменения скриптов, затем выполните:

```bash
cd /opt/interview-online/repo
git pull origin main
sudo stat -c '%n: %s bytes, mode %a' /tmp/drawio-32.6.10.war
sudo DRAWIO_ARCHIVE_PATH=/tmp/drawio-32.6.10.war ./deploy/scripts/deploy_docker.sh --enable-canvases
```

Если `stat` сообщает, что файла нет, сначала завершите перенос через `scp`.
Для закреплённого архива ожидается размер **49 729 549 байт**. Если файл есть,
но чтение/запись кэша не работает, новая диагностика скрипта указывает отдельно
офлайн-вход или кэш; проверяйте указанный путь, а не меняйте права всего репозитория.

Скрипт проверит архив и атомарно скопирует его в постоянный кэш. Произвольный
архив или файл другой версии не принимается. Контрольная сумма версии 32.6.10:
`a57b06b3b6a876a351dacfe65d027d9509319cd030e9bacf6ae04a034d66a38f`.
После успешной подготовки копия в `/tmp` больше не нужна.
`DRAWIO_DOWNLOAD_TIMEOUT_MS` (по умолчанию 180000, максимум 900000) и
`DRAWIO_DOWNLOAD_ATTEMPTS` (по умолчанию 2, максимум 3) позволяют ограничить
сетевые попытки; при валидном кэше загрузки нет. Первая загрузка остальных
Docker/npm зависимостей по-прежнему требует соответствующего доступа к сети.

**На обычном обновлении SSL-скрипт (`init_ssl_docker.sh`) запускать не нужно.**

---

## Перед деплоем (локально)

```bash
git status
git push origin main
```

Убедитесь, что на `main` попали нужные коммиты.

Командные пространства доступны во всех сборках. Перед первым обновлением
добавьте в существующий `/etc/interview-online/.env` на каждом сервере:

```env
TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID=primary
TEAM_INVITATION_LINK_ENCRYPTION_KEY=<сохранённый_32-byte_Base64URL_ключ_без_padding>
```

Сохраняйте этот ключ при последующих релизах и во всех репликах. Если в БД
уже есть приглашения, используйте прежний ключ и сохраняйте все версии,
на которые они ссылаются. Основной Compose передаёт ключ `primary`; ротация
требует override с полным набором ключей. Не заменяйте серверный `.env`
примером целиком: в нём уже находятся параметры БД и постоянный ключ чата.

---

## Сервер 1 — `interview.vtools.tech` (основной)

| Параметр | Значение |
|----------|----------|
| Домен | `interview.vtools.tech` |
| VM | `10.2.2.2` |
| SSH | `romazh@10.2.2.2` (через WireGuard; шлюз `37.18.73.150`) |
| Репозиторий | `/opt/interview-online/repo` |
| Environment | `/etc/interview-online/.env` |

### Шаги

```bash
# 1. Подключиться (с машины, где поднят WireGuard)
ssh romazh@10.2.2.2

# 2. Забрать изменения
cd /opt/interview-online/repo
git fetch origin
git pull origin main

# 3. Пересобрать и перезапустить
/opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

Для включения обоих холстов в этом релизе вместо обычной команды выполните:

```bash
sudo /opt/interview-online/repo/deploy/scripts/deploy_docker.sh --enable-canvases
```

Опция должна быть доступна в обновлённом checkout. Для уже выложенного кода без
неё достаточно вручную сохранить оба значения `true` в существующем `.env`,
затем снова выполнить обычный `deploy_docker.sh`. Флаги только в shell перед
командой ненадёжны: скрипт читает серверный файл и может переопределить их.

### Проверка после деплоя

```bash
curl -fsS https://interview.vtools.tech/healthz
```

В браузере: `https://interview.vtools.tech/`

---

## Сервер 2 — `interview.domiknote.ru` (legacy)

| Параметр | Значение |
|----------|----------|
| Домен | `interview.domiknote.ru` |
| Хост | `root@194.87.187.153` (`msk-1-vm-8b2x`) |
| Репозиторий | `/opt/interview-online/repo` |
| Environment | `/etc/interview-online/.env` |

> **Важно:** этот сервер раньше работал **без Docker** (systemd + nginx на хосте).  
> В `main` остался только Docker-деплой. Если видите `docker compose plugin is not installed` —  
> сначала **один раз мигрируйте на Docker**: [`DOMIKNOTE_DOCKER_MIGRATION_RU.md`](./DOMIKNOTE_DOCKER_MIGRATION_RU.md)

### Шаги (после миграции на Docker)

```bash
# 1. Подключиться к серверу
ssh root@194.87.187.153

# 2. Забрать изменения
cd /opt/interview-online/repo
git fetch origin
git pull origin main

# 3. Пересобрать и перезапустить
/opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

### Проверка после деплоя

```bash
curl -fsS https://interview.domiknote.ru/healthz
```

---

## Важно: `.env` на каждом сервере свой

Файл `/etc/interview-online/.env` **не в git**. На каждом сервере должны быть свои `DOMAIN` и `CORS_ORIGINS`:

**Сервер vtools:**

```env
DOMAIN=interview.vtools.tech
CORS_ORIGINS=https://interview.vtools.tech
NGINX_SSL=true
```

**Сервер domiknote:**

```env
DOMAIN=interview.domiknote.ru
CORS_ORIGINS=https://interview.domiknote.ru
NGINX_SSL=true
```

При `git pull` этот файл **не перезаписывается**. Новые обязательные параметры
релиза добавляйте отдельно, сохраняя действующие параметры БД и ключи.

Просмотр (без вывода пароля в лог):

```bash
grep -E '^(DOMAIN|CORS_ORIGINS|NGINX_SSL|HTTP_PORT)=' /etc/interview-online/.env
```

---

## Быстрая шпаргалка (одна команда на сервере)

Если репозиторий уже клонирован и `.env` настроен:

```bash
cd /opt/interview-online/repo && git pull origin main && ./deploy/scripts/deploy_docker.sh
```

---

## Управление стеком (если деплой упал)

```bash
cd /opt/interview-online/repo
COMPOSE="docker compose -f docker-compose.prod.yml --env-file /etc/interview-online/.env"

$COMPOSE ps
$COMPOSE logs --tail=120 backend
$COMPOSE logs --tail=120 web
```

Перезапуск без пересборки (редко нужно):

```bash
$COMPOSE up -d
```

Полная остановка:

```bash
$COMPOSE down
```

> `down` **не удаляет** данные PostgreSQL (volume `interview_pgdata`).

---

## Типичные проблемы

### `git pull` просит логин / не может скачать

На сервере должен быть доступ к GitHub (HTTPS + token или SSH-ключ).

### `Permission denied` при docker

```bash
sudo usermod -aG docker $USER
# перелогиниться
```

### `Environment file is missing`

Первичная настройка (один раз):

```bash
sudo mkdir -p /etc/interview-online
sudo cp /opt/interview-online/repo/deploy/env/docker.env.example /etc/interview-online/.env
sudo nano /etc/interview-online/.env
```

### Сборка frontend долго идёт

Нормально: `npm ci` + `npm run build` внутри Docker. Первый build после больших изменений может занять несколько минут.

### `TEAM_INVITATION_LINK_ENCRYPTION_KEY must be ...`

В существующем серверном `.env` задайте постоянный 32-byte Base64URL ключ
без padding для `primary`. Пустое значение, пример-заглушка, padding и
неправильная длина останавливают деплой до сборки и изменения контейнеров.
Подробности: [настройка environment](VTOLS_DEPLOYMENT_RUNBOOK_RU.md#3-environment).

### Health check failed после деплоя

```bash
docker compose -f /opt/interview-online/repo/docker-compose.prod.yml \
  --env-file /etc/interview-online/.env logs --tail=200 backend web
```

---

## Первичная установка (если сервер ещё не настроен)

Полный runbook для vtools: `docs/deployment/VTOLS_DEPLOYMENT_RUNBOOK_RU.md`

Кратко:

1. Установить Docker
2. `git clone` в `/opt/interview-online/repo`
3. Создать `/etc/interview-online/.env`
4. `deploy_docker.sh` (HTTP)
5. `init_ssl_docker.sh` (HTTPS, один раз)

---

## Порядок обновления двух серверов

1. `git push` с локальной машины
2. Деплой на **vtools** (основной домен)
3. Проверка `https://interview.vtools.tech/healthz`
4. Деплой на **domiknote** (legacy)
5. Проверка `https://interview.domiknote.ru/healthz`

Можно деплоить в любом порядке — серверы независимы, но удобнее сначала основной.
