# Деплой Interview Online на поддомен (ручной + GitHub Actions)

## Цель

Поднять проект `interview-online-codex` на отдельном поддомене, чтобы не пересекаться с уже работающим проектом на `domiknote.ru`.

Рекомендуемый поддомен в этом runbook: `interview.domiknote.ru`.

## Что уже подготовлено в репозитории

- `frontend` больше не зависит от хардкодов `localhost`:
  - API по умолчанию: `/api`
  - WebSocket по умолчанию: `ws(s)://<same-host>/ws`
- Dev proxy для локальной разработки добавлен в `frontend/rspack.config.mjs`.
- Готовые серверные шаблоны:
  - `deploy/env/backend.env.example`
  - `deploy/systemd/interview-online-backend.service`
  - `deploy/nginx/interview-online-subdomain.conf`
  - `deploy/scripts/deploy_subdomain.sh`
  - `deploy/scripts/rollback_subdomain.sh`

## 1. DNS (поддомен)

В DNS-зоне `domiknote.ru` добавьте:

- `A` запись: `interview` -> `<IP вашего сервера>`
- (опционально) `AAAA` запись для IPv6

Проверка:

```bash
dig +short interview.domiknote.ru
```

## 2. Базовая подготовка сервера (Ubuntu 22.04/24.04)

```bash
sudo apt update
sudo apt install -y git rsync curl nginx certbot python3-certbot-nginx \
  openjdk-17-jre-headless maven postgresql postgresql-contrib

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Пользователь и директории:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG www-data deploy

sudo mkdir -p /opt/interview-online/{repo,releases}
sudo chown -R deploy:www-data /opt/interview-online
```

## 3. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='interview') THEN
    CREATE ROLE interview LOGIN PASSWORD 'change-me';
  END IF;
END $$;

SELECT 'CREATE DATABASE interview_online OWNER interview'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='interview_online')\gexec
SQL
```

## 4. Клонирование проекта

```bash
sudo -u deploy git clone https://github.com/boumrz/interview-online-codex.git /opt/interview-online/repo
```

## 5. Конфиг backend environment

```bash
sudo mkdir -p /etc/interview-online
sudo cp /opt/interview-online/repo/deploy/env/backend.env.example /etc/interview-online/backend.env
sudo nano /etc/interview-online/backend.env
sudo chown root:deploy /etc/interview-online/backend.env
sudo chmod 640 /etc/interview-online/backend.env
```

Минимально проверьте значения:

- `SERVER_PORT=18080` (отдельный внутренний порт)
- `DB_URL=jdbc:postgresql://127.0.0.1:5432/interview_online`
- `DB_USER=interview`
- `DB_PASSWORD=<ваш пароль>`
- `CORS_ORIGINS=https://interview.domiknote.ru`

## 6. systemd service

```bash
sudo cp /opt/interview-online/repo/deploy/systemd/interview-online-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable interview-online-backend
```

## 7. Nginx vhost для поддомена

```bash
sudo cp /opt/interview-online/repo/deploy/nginx/interview-online-subdomain.conf /etc/nginx/sites-available/interview-online-subdomain.conf
sudo ln -s /etc/nginx/sites-available/interview-online-subdomain.conf /etc/nginx/sites-enabled/interview-online-subdomain.conf
sudo nginx -t
sudo systemctl reload nginx
```

Шаблон в репозитории намеренно `HTTP-only` для первого запуска.

## 8. SSL сертификат (Let's Encrypt)

```bash
sudo certbot --nginx -d interview.domiknote.ru --agree-tos -m admin@domiknote.ru --redirect
```

`certbot --nginx` автоматически добавит TLS-директивы в конфиг и включит редирект на HTTPS.

## 9. Первый деплой

```bash
sudo chmod +x /opt/interview-online/repo/deploy/scripts/*.sh

sudo -u deploy env \
  APP_ROOT=/opt/interview-online \
  DOMAIN=interview.domiknote.ru \
  /opt/interview-online/repo/deploy/scripts/deploy_subdomain.sh
```

Что делает скрипт:

- подтягивает `main`,
- собирает frontend (`npm ci`, `typecheck`, `build`),
- собирает backend jar (`mvn -DskipTests package`),
- создаёт release в `/opt/interview-online/releases/<timestamp>`,
- переключает symlink `current`,
- перезапускает backend и reload nginx,
- делает smoke-check.

## 10. Проверки после деплоя

```bash
systemctl status interview-online-backend --no-pager
journalctl -u interview-online-backend -n 100 --no-pager
curl -fsS https://interview.domiknote.ru/healthz | head
```

Локальная проверка backend в обход nginx:

```bash
curl -fsS http://127.0.0.1:18080/api/agent/environment/doctor | head
```

## 11. Повторный деплой

```bash
sudo -u deploy env \
  APP_ROOT=/opt/interview-online \
  DOMAIN=interview.domiknote.ru \
  /opt/interview-online/repo/deploy/scripts/deploy_subdomain.sh
```

## 12. Rollback

Список релизов:

```bash
ls -1 /opt/interview-online/releases
```

Откат:

```bash
sudo -u deploy env APP_ROOT=/opt/interview-online \
  /opt/interview-online/repo/deploy/scripts/rollback_subdomain.sh <release-id>
```

## 13. Автодеплой по `git push` через GitHub Actions

Схема: `push в main` -> GitHub Actions workflow -> SSH на сервер -> запуск `deploy_subdomain.sh` -> перезапуск backend/nginx.

### 13.1. Подготовить права deploy-пользователя (обязательно)

`deploy_subdomain.sh` внутри себя вызывает `sudo systemctl ...`, поэтому для CI нужен парольless sudo.

```bash
sudo cp /opt/interview-online/repo/deploy/env/sudoers-deploy-interview-online.example /etc/sudoers.d/deploy-interview-online
sudo chmod 440 /etc/sudoers.d/deploy-interview-online
sudo visudo -cf /etc/sudoers.d/deploy-interview-online
```

### 13.2. Добавить CI SSH ключ на сервер

Сгенерируйте отдельный deploy-ключ (без passphrase) и добавьте публичную часть в:

```bash
/home/deploy/.ssh/authorized_keys
```

Права:

```bash
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

### 13.3. Настроить GitHub Secrets и Variables

В репозитории GitHub: **Settings -> Secrets and variables -> Actions**.

Secrets:

- `DEPLOY_SSH_HOST` — IP или домен сервера
- `DEPLOY_SSH_USER` — обычно `deploy`
- `DEPLOY_SSH_PRIVATE_KEY` — приватный ключ для SSH

Variables:

- `DEPLOY_SSH_PORT` — обычно `22`
- `DEPLOY_APP_ROOT` — `/opt/interview-online`
- `DEPLOY_DOMAIN` — `interview.domiknote.ru`

### 13.4. Workflow уже добавлен в репозиторий

Файл:

- `.github/workflows/deploy-subdomain.yml`

Триггеры:

- автоматически на `push` в `main`
- вручную через `workflow_dispatch` (можно указать branch)

### 13.5. Проверка автодеплоя

1. Сделайте push в `main`.
2. Откройте **GitHub -> Actions -> Deploy Interview Subdomain**.
3. На сервере проверьте:

```bash
ls -lt /opt/interview-online/releases | head
systemctl status interview-online-backend --no-pager
journalctl -u interview-online-backend -n 100 --no-pager
curl -fsS https://interview.domiknote.ru/healthz | head
```

### 13.6. Ручной запуск из Actions (если нужно)

Вкладка **Actions** -> workflow **Deploy Interview Subdomain** -> **Run workflow**.

Это удобно для повторного выката без нового коммита.

## Почему это не затронет существующий проект

- отдельный `server_name` в nginx: только `interview.domiknote.ru`;
- отдельный systemd сервис: `interview-online-backend`;
- отдельный путь приложения: `/opt/interview-online`;
- отдельный внутренний порт backend: `18080`;
- отдельная БД `interview_online` (или отдельный пользователь/схема по вашему выбору).
