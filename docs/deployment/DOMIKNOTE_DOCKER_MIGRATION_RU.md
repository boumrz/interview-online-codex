# Миграция interview.domiknote.ru на Docker

Сервер `msk-1-vm-8b2x` (`194.87.187.153`) раньше работал **без Docker**:
systemd + nginx на хосте + PostgreSQL на хосте.

В актуальном `main` остался **только Docker-деплой** (`deploy_docker.sh`).
Скрипты `deploy_subdomain.sh`, systemd unit и nginx-конфиг с хоста **удалены из репозитория**.

Ошибка `docker compose plugin is not installed` означает, что Docker Compose v2 не установлен.
Проще **один раз мигрировать** на Docker, чем поддерживать старую схему вручную.

---

## Что будет после миграции

```text
Интернет → :80/:443 → [web: nginx + frontend] → [backend] → [postgres в Docker]
```

Тот же стек, что на `interview.vtools.tech`.

---

## Шаг 0. Посмотреть, что сейчас крутится

На сервере:

```bash
# Старый backend?
systemctl status interview-online-backend 2>/dev/null || true

# Nginx на хосте?
systemctl status nginx 2>/dev/null || true

# Postgres на хосте?
systemctl status postgresql 2>/dev/null || true

# Кто занял 80/443
ss -tlnp | grep -E ':80|:443'

# Есть ли уже Docker
docker --version 2>/dev/null || echo "docker not installed"
docker compose version 2>/dev/null || echo "compose plugin not installed"

# Где лежат релизы (старая схема)
ls -la /opt/interview-online/ 2>/dev/null || true
```

Запишите, есть ли важные данные в **хостовом** PostgreSQL — их нужно будет перенести.

---

## Шаг 1. Бэкап БД (если postgres на хосте)

```bash
sudo -u postgres pg_dump -Fc interview_online > /root/interview_online_backup_$(date +%F).dump
ls -lh /root/interview_online_backup_*.dump
```

Если базы нет или она пустая — шаг можно пропустить.

---

## Шаг 2. Установить Docker + Compose plugin

```bash
apt update
apt install -y ca-certificates curl git

# Официальный скрипт Docker (ставит Engine + compose plugin)
curl -fsSL https://get.docker.com | sh

# Проверка
docker --version
docker compose version
```

Должно быть что-то вроде `Docker Compose version v2.x`, **не** отдельная команда `docker-compose` v1.

---

## Шаг 3. Остановить старый стек (освободить 80/443)

```bash
# Backend (если был)
systemctl stop interview-online-backend 2>/dev/null || true
systemctl disable interview-online-backend 2>/dev/null || true

# Nginx на хосте — Docker-web займёт 80/443
systemctl stop nginx
systemctl disable nginx

# Проверить порты
ss -tlnp | grep -E ':80|:443' || echo "ports 80/443 are free"
```

> Certbot на хосте (`/etc/letsencrypt`) можно оставить — при миграции SSL выпустим заново через `init_ssl_docker.sh` или перенесём позже.

---

## Шаг 4. Создать `/etc/interview-online/.env`

```bash
mkdir -p /etc/interview-online
cp /opt/interview-online/repo/deploy/env/docker.env.example /etc/interview-online/.env
nano /etc/interview-online/.env
```

Минимум для domiknote:

```env
DOMAIN=interview.domiknote.ru
HTTP_PORT=80
HTTPS_PORT=443
NGINX_SSL=false

DB_NAME=interview_online
DB_USER=interview
DB_PASSWORD=<надёжный_пароль>

CORS_ORIGINS=https://interview.domiknote.ru
CERTBOT_EMAIL=<ваш_email>
```

```bash
chmod 600 /etc/interview-online/.env
```

---

## Шаг 5. Первый запуск (HTTP)

```bash
chmod +x /opt/interview-online/repo/deploy/scripts/*.sh
/opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

Скрипт соберёт образы (5–15 минут на слабой VM) и поднимет контейнеры.

Проверка:

```bash
curl -fsS http://127.0.0.1/healthz
curl -fsS http://interview.domiknote.ru/healthz
```

---

## Шаг 6. SSL (один раз)

```bash
/opt/interview-online/repo/deploy/scripts/init_ssl_docker.sh
curl -fsS https://interview.domiknote.ru/healthz
```

---

## Шаг 7. Перенос данных из старого Postgres (если был бэкап)

После того как Docker-postgres поднялся:

```bash
cd /opt/interview-online/repo
source /etc/interview-online/.env

# Скопировать дамп в контейнер и восстановить
docker compose -f docker-compose.prod.yml --env-file /etc/interview-online/.env \
  cp /root/interview_online_backup_YYYY-MM-DD.dump postgres:/tmp/backup.dump

docker compose -f docker-compose.prod.yml --env-file /etc/interview-online/.env \
  exec -T postgres pg_restore -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists /tmp/backup.dump
```

Если `pg_restore` ругается на чистую БД — сначала только данные без `--clean`, или восстановите в пустую БД по документации PostgreSQL.

Перезапуск backend после restore:

```bash
docker compose -f docker-compose.prod.yml --env-file /etc/interview-online/.env restart backend
```

---

## Дальнейшие обновления (как на vtools)

```bash
cd /opt/interview-online/repo
git pull origin main
/opt/interview-online/repo/deploy/scripts/deploy_docker.sh
```

---

## Альтернатива: не мигрировать на Docker

Теоретически можно вручную собрать backend (Maven), frontend (`npm run build`), положить в nginx и systemd — **но скриптов в репозитории больше нет**, каждое обновление придётся повторять руками.

**Рекомендация:** мигрировать на Docker один раз и дальше использовать `deploy_docker.sh`.

---

## Альтернатива: отключить legacy-сервер

Если основной трафик уже на `interview.vtools.tech`, можно:

1. Оставить на domiknote только редирект на vtools (nginx на хосте без полного стека)
2. Или выключить сервер после даты отключения legacy-домена (см. баннер в приложении)

Это дешевле по поддержке, если legacy почти не используется.

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| `docker compose plugin is not installed` | Шаг 2 — `curl -fsSL https://get.docker.com \| sh` |
| Порт 80 занят | `systemctl stop nginx`; проверить `ss -tlnp` |
| Мало RAM при сборке | Добавить swap или собирать с `DOCKER_BUILDKIT=1`; VM 1GB — впритык |
| SSL не выпускается | DNS `interview.domiknote.ru` → IP сервера; порт 80 открыт |
| Пустая БД после миграции | Восстановить дамп (шаг 7) |
