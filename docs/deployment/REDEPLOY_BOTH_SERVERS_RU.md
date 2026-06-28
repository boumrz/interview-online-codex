# Обновление (redeploy) на двух production-серверах

Ручной деплой: **git push** с локальной машины → **git pull** на каждом сервере → **`deploy_docker.sh`**.

CI/CD в проекте не используется.

## Что делает `deploy_docker.sh`

Скрипт `deploy/scripts/deploy_docker.sh` автоматически:

1. Собирает Docker-образы (`backend`, `frontend` + nginx)
2. Поднимает стек из `docker-compose.prod.yml` (`postgres`, `backend`, `web`)
3. Ждёт health backend
4. Проверяет `http://127.0.0.1/healthz` и главную страницу
5. Если в `.env` включён SSL (`NGINX_SSL=true`) — проверяет `https://<DOMAIN>/`

**На обычном обновлении SSL-скрипт (`init_ssl_docker.sh`) запускать не нужно.**

---

## Перед деплоем (локально)

```bash
git status
git push origin main
```

Убедитесь, что на `main` попали нужные коммиты.

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

При `git pull` этот файл **не перезаписывается**. Менять его нужно только если меняется домен или пароль БД.

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
