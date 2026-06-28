# Shared Proxy For domiknote.ru And Interview

Этот runbook нужен для сервера, где один публичный контейнер
`interview-online-web` принимает порты `80/443`, а Finance Assistant работает
в отдельном Docker Compose stack.

## Что исправляет

Старый production Nginx в `interview-online-web` использовал `server_name _`.
Из-за этого `https://domiknote.ru/` попадал в interview container, получал
сертификат interview-домена и отдавал не тот frontend.

Новая схема:

```text
internet :80/:443
  -> interview-online-web
       interview.vtools.tech      -> interview-online frontend/backend
       interview.domiknote.ru     -> interview-online frontend/backend
       domiknote.ru               -> finance-assistant-web-1:80
```

## Перед включением

Создайте общую Docker-сеть один раз:

```bash
docker network create domiknote_proxy || true
```

Finance Assistant `web` должен быть подключен к этой сети через
`compose.domiknote.yml`. Interview stack подключается к ней через override:

```bash
COMPOSE_FILES=/opt/interview-online/repo/docker-compose.prod.yml:/opt/interview-online/repo/docker-compose.shared-proxy.yml
```

В `/etc/interview-online/.env` задайте:

```bash
DOMAIN=interview.vtools.tech
INTERVIEW_SERVER_NAMES=interview.vtools.tech,interview.domiknote.ru
FINANCE_DOMAIN=domiknote.ru
FINANCE_CERT_DOMAIN=domiknote.ru
FINANCE_WEB_UPSTREAM=finance-assistant-web-1:80
SHARED_PROXY_NETWORK=domiknote_proxy
```

`FINANCE_PROXY_ENABLED=true` включайте только после выпуска сертификата
`domiknote.ru`, иначе Nginx остановится с понятной ошибкой о недостающем cert.

## Сертификаты

Скрипт `deploy/scripts/init_ssl_docker.sh` использует compose certbot service и
те же Docker volumes, которые видит `interview-online-web`. Не запускайте
`docker run certbot/certbot` с путями "наугад": challenge окажется не в том
volume, и Let's Encrypt вернет `404`.

Сначала выпустите или обновите cert для interview-доменов:

```bash
CERTBOT_DOMAINS=interview.vtools.tech,interview.domiknote.ru \
COMPOSE_FILES=/opt/interview-online/repo/docker-compose.prod.yml:/opt/interview-online/repo/docker-compose.shared-proxy.yml \
deploy/scripts/init_ssl_docker.sh
```

Потом выпустите cert для Finance Assistant domain:

```bash
CERTBOT_DOMAINS=domiknote.ru \
COMPOSE_FILES=/opt/interview-online/repo/docker-compose.prod.yml:/opt/interview-online/repo/docker-compose.shared-proxy.yml \
deploy/scripts/init_ssl_docker.sh
```

После появления `/etc/letsencrypt/live/domiknote.ru` внутри
`interview-online-web` включите finance proxy:

```bash
FINANCE_PROXY_ENABLED=true
```

и перезапустите deploy:

```bash
COMPOSE_FILES=/opt/interview-online/repo/docker-compose.prod.yml:/opt/interview-online/repo/docker-compose.shared-proxy.yml \
deploy/scripts/deploy_docker.sh
```

## Проверка

```bash
docker exec interview-online-web nginx -t
docker exec interview-online-web sh -lc "ls -la /etc/letsencrypt/live"

curl -Ik https://interview.vtools.tech/
curl -Ik https://interview.domiknote.ru/
curl -Ik https://domiknote.ru/
curl -fsS https://domiknote.ru/api/health
```

Ожидаемо:

- `interview.vtools.tech` отдает interview app.
- `interview.domiknote.ru` отдает interview app и показывает legacy notice.
- `domiknote.ru` отдает Finance Assistant.
- `domiknote.ru/api/health` возвращает health Finance Assistant API.
- `domiknote.ru` больше не получает certificate mismatch от interview cert.

## Rollback

Если finance upstream недоступен, временно выключите:

```bash
FINANCE_PROXY_ENABLED=false
```

и перезапустите `interview-online-web`. Не возвращайте `server_name _` для
interview HTTPS vhost, потому что это снова начнет обслуживать `domiknote.ru`
не тем приложением.
