# Деплой InterHub на interview.vtools.tech (Docker)

Домен: `https://interview.vtools.tech/`  
Шлюз: `37.18.73.150` (порты 80, 443)  
VM: `10.2.2.2`  
SSH: `romazh@10.2.2.2` (через WireGuard)

Деплой **ручной**: `git pull` на сервере → `deploy_docker.sh`. CI/CD не используется.

## Архитектура

```text
Интернет → 37.18.73.150:80/443 → VM → [web] → [backend] → [postgres]
```

| Контейнер | Роль |
|---|---|
| `interview-online-web` | frontend + nginx (прокси `/api`, `/ws`) |
| `interview-online-backend` | Spring Boot API |
| `interview-online-postgres` | PostgreSQL |

---

## Первичная настройка (один раз)

### 1. Docker

```bash
ssh romazh@10.2.2.2

sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker romazh
exit
```

Перелогиниться и проверить: `docker compose version`

### 2. Репозиторий

```bash
sudo mkdir -p /opt/interview-online
sudo chown -R romazh:romazh /opt/interview-online
git clone https://github.com/boumrz/interview-online-codex.git /opt/interview-online/repo
```

### 3. Environment

```bash
sudo mkdir -p /etc/interview-online
sudo cp /opt/interview-online/repo/deploy/env/docker.env.example /etc/interview-online/.env
sudo nano /etc/interview-online/.env
sudo chown root:romazh /etc/interview-online/.env
sudo chmod 640 /etc/interview-online/.env
```

```env
DOMAIN=interview.vtools.tech
HTTP_PORT=80
HTTPS_PORT=443
NGINX_SSL=false

DB_NAME=interview_online
DB_USER=interview
DB_PASSWORD=<пароль>

CHAT_RECEIPT_HMAC_SECRET=<сохранённый_32-byte_Base64URL_secret>
TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID=primary
TEAM_INVITATION_LINK_ENCRYPTION_KEY=<сохранённый_32-byte_Base64URL_ключ>

CORS_ORIGINS=https://interview.vtools.tech
CERTBOT_EMAIL=<email>
```

Командные пространства входят в обычную сборку. Ключ приглашений обязателен:
используйте постоянный 32-byte Base64URL ключ без padding и сохраняйте его
после обновлений и перезапусков. Значения ключей храните вне git и не выводите
в диагностические логи. Основной Compose передаёт `keys.primary`; для ротации
используйте конфигурационный override с полным набором версий ключей и
сохраняйте прежние версии до завершения связанных ожидающих приглашений.
Скрипт проверяет ключ и Compose до сборки и изменения контейнеров.

### 4. Первый запуск (HTTP)

```bash
chmod +x /opt/interview-online/repo/deploy/scripts/*.sh
/opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

### 5. SSL

```bash
/opt/interview-online/repo/deploy/scripts/init_ssl_docker.sh
curl -fsS https://interview.vtools.tech/healthz
```

---

## Обновление (каждый релиз)

Перед первым обновлением с командными пространствами добавьте параметры
ключа приглашений в существующий `/etc/interview-online/.env`; сохраняйте
имеющиеся параметры БД и ключ чата. Последующие релизы используют тот же ключ.

```bash
ssh romazh@10.2.2.2

cd /opt/interview-online/repo
git pull origin main

/opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

После health-проверки войдите в кабинет: проверьте выбор личного пространства
и команд, создание команды и управление участниками. Для глобального
администратора проверьте ссылку «Админка» и список пользователей.

---

## Управление

```bash
cd /opt/interview-online/repo
COMPOSE="docker compose -f docker-compose.prod.yml --env-file /etc/interview-online/.env"

$COMPOSE ps
$COMPOSE logs --tail=100 backend
$COMPOSE down          # остановить
$COMPOSE up -d         # запустить без пересборки
```

Продление SSL (cron раз в ~60 дней):

```bash
$COMPOSE --profile certbot run --rm certbot renew
$COMPOSE up -d web
```

---

## Файлы деплоя

| Файл | Назначение |
|---|---|
| `docker-compose.prod.yml` | production stack |
| `backend/Dockerfile` | образ backend |
| `frontend/Dockerfile` | образ frontend + nginx |
| `deploy/env/docker.env.example` | шаблон `/etc/interview-online/.env` |
| `deploy/scripts/deploy_docker.sh` | сборка и запуск |
| `deploy/scripts/init_ssl_docker.sh` | выпуск SSL |

---

## Локальный запуск (для тестов на Mac)

На сервере этот шаг не нужен. Для проверки образов локально:

```bash
# из корня репозитория
./deploy/scripts/run_docker_local.sh up
```

Откроется `http://localhost:8888`. Остановка: `./deploy/scripts/run_docker_local.sh down`.

На Apple Silicon используется `docker-compose.local.yml` (backend собирается как `linux/amd64`).
