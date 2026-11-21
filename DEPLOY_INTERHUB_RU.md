# Выкладка InterHub на interview.vtools.tech

Для обычного обновления достаточно отправить проверенный коммит в `main`, забрать его на сервере и запустить штатный скрипт. Обучение, редактор диаграмм, доска и страницы документов входят в сборку. Настройки OAuth нужны один раз для каждого провайдера.

| Где | Что уже подготовлено |
| --- | --- |
| Mac | Обе пары OAuth и общий ключ находятся в `~/.config/interhub/deploy/social-auth-production.env`. Файл принадлежит текущему пользователю, права `600`. |
| Сервер | `romazh@10.2.2.2` через WireGuard, репозиторий `/opt/interview-online/repo`, окружение `/etc/interview-online/.env`. |
| Публичный адрес | `https://interview.vtools.tech`. У Google и GitHub сохранены адреса возврата на этом домене. |

21 ноября публичная проверка здоровья прошла. Сервер ещё отдавал главную страницу по `/privacy` и `/terms`, а список способов входа OAuth был пуст. Сначала выложите приложение и включите GitHub. После появления публичных документов можно закончить настройку Google.

## 1. Подготовьте коммит

На Mac проверьте, что нужные изменения зафиксированы в `main`. Сверьте короткий хеш, который планируете выложить, затем отправьте ветку.

```bash
git status --short --branch
git log -1 --oneline main
git push origin main
```

## 2. Сохраните текущую версию

На Mac подключите WireGuard и откройте серверный терминал.

```bash
ssh romazh@10.2.2.2
```

На сервере выполните блок в Bash от обычного пользователя выкладки. Он сохраняет окружение, дамп PostgreSQL и текущие образы до обновления. Используются файлы Compose из действующих настроек, включая отдельный прокси, если он задан.

```bash
set -euo pipefail
set +x
umask 077
cd /opt/interview-online/repo
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"

interhub_compose() (
  set +x
  source /etc/interview-online/.env
  IFS=: read -r -a interhub_files <<< "${COMPOSE_FILES:-${COMPOSE_FILE:-$PWD/docker-compose.prod.yml}}"
  interhub_args=()
  for interhub_file in "${interhub_files[@]}"; do
    interhub_args+=(-f "$interhub_file")
  done
  docker compose "${interhub_args[@]}" --env-file /etc/interview-online/.env "$@"
)

mkdir -p /opt/interview-online/backups
INTERHUB_BACKUP="$(mktemp -d /opt/interview-online/backups/release-XXXXXXXX)"
INTERHUB_RELEASE_ID="${INTERHUB_BACKUP##*/}"
git rev-parse HEAD > "$INTERHUB_BACKUP/previous-commit.txt"
cp /etc/interview-online/.env "$INTERHUB_BACKUP/server.env"
chmod 600 "$INTERHUB_BACKUP/server.env"
interhub_compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$INTERHUB_BACKUP/postgres.dump"
test -s "$INTERHUB_BACKUP/postgres.dump"
interhub_compose exec -T postgres pg_restore --list < "$INTERHUB_BACKUP/postgres.dump" > "$INTERHUB_BACKUP/postgres-contents.txt"

for interhub_service in backend web; do
  interhub_container="$(interhub_compose ps -q "$interhub_service")"
  interhub_image="$(docker inspect --format '{{.Image}}' "$interhub_container")"
  docker image tag "$interhub_image" "interhub-${interhub_service}:${INTERHUB_RELEASE_ID}"
done
docker image save -o "$INTERHUB_BACKUP/previous-images.tar" \
  "interhub-backend:${INTERHUB_RELEASE_ID}" "interhub-web:${INTERHUB_RELEASE_ID}"
cat > "$INTERHUB_BACKUP/rollback-images.yml" <<EOF
services:
  backend:
    image: interhub-backend:${INTERHUB_RELEASE_ID}
    pull_policy: never
  web:
    image: interhub-web:${INTERHUB_RELEASE_ID}
    pull_policy: never
EOF
printf 'Резервная копия: %s\n' "$INTERHUB_BACKUP"
```

Сохраните путь к резервной копии. Архив и окружение содержат рабочие данные, поэтому храните их в закрытом каталоге. `pg_restore --list` проверяет читаемость архива. [Эксплуатация сервера](docs/deployment/VTOLS_DEPLOYMENT_RUNBOOK_RU.md)

## 3. Подключите GitHub один раз

В отдельном терминале Mac передайте подготовленный файл по SSH. Значения передаются через защищённое соединение и не выводятся в терминал. Временная копия на сервере доступна только владельцу.

```bash
set +x
ssh romazh@10.2.2.2 'set -eu
  umask 077
  interhub_stage="$HOME/.config/interhub/deploy"
  mkdir -p "$interhub_stage"
  chmod 700 "$interhub_stage"
  interhub_tmp=$(mktemp "$interhub_stage/oauth.XXXXXXXX")
  trap '\''rm -f -- "$interhub_tmp"'\'' EXIT
  cat > "$interhub_tmp"
  test -s "$interhub_tmp"
  mv -f -- "$interhub_tmp" "$interhub_stage/social-auth-production.env"' \
  < "$HOME/.config/interhub/deploy/social-auth-production.env"
```

Затем в серверном терминале скопируйте следующий блок. Он добавляет в действующий `.env` отсутствующие параметры выбранного провайдера. Пара другого провайдера, ключи БД, чата и приглашений сохраняются. Действующий `SOCIAL_AUTH_FLOW_SECRET` имеет приоритет над локальной копией.

```bash
sudo python3 - "$HOME/.config/interhub/deploy/social-auth-production.env" github <<'PY'
import os
import re
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

staged = Path(sys.argv[1])
provider = sys.argv[2].upper()
if provider not in {"GITHUB", "GOOGLE"}:
    raise SystemExit("Ожидаемый провайдер: github или google.")
if staged.is_symlink() or not staged.is_file() or staged.stat().st_mode & 0o077:
    raise SystemExit("Проверьте, что приватный файл существует и доступен только владельцу.")

target = Path("/etc/interview-online/.env")
if target.is_symlink() or not target.is_file():
    raise SystemExit("Ожидается действующий файл /etc/interview-online/.env.")
if target.stat().st_mode & 0o007:
    raise SystemExit("Ограничьте доступ к серверному .env до 640 или 600 перед добавлением ключей.")

pair = (f"{provider}_CLIENT_ID", f"{provider}_CLIENT_SECRET")
keys = (*pair, "PUBLIC_BASE_URL", "SOCIAL_AUTH_FLOW_SECRET")
assignment = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")

def read_values(contents):
    values = {}
    for index, line in enumerate(contents.splitlines()):
        match = assignment.fullmatch(line)
        if not match or match[1] not in keys:
            continue
        if match[1] in values:
            raise SystemExit(f"В окружении повторяется ключ {match[1]}.")
        value = match[2].split(" #", 1)[0].strip().strip("\"'")
        values[match[1]] = (index, value)
    return values

origin = "https://interview.vtools.tech"
prepared = {key: value for key, (_, value) in read_values(staged.read_text()).items()}
if any(not re.fullmatch(r"[A-Za-z0-9_:./-]+", prepared.get(key, "")) for key in keys):
    raise SystemExit("В приватном файле отсутствует необходимое значение или формат не поддерживается.")
if prepared["PUBLIC_BASE_URL"] != origin or not re.fullmatch(
    r"[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]", prepared["SOCIAL_AUTH_FLOW_SECRET"]
):
    raise SystemExit("Проверьте адрес приложения и общий ключ OAuth в приватном файле.")

previous = target.read_text()
lines = previous.splitlines(keepends=True)
current = read_values(previous)
if current.get("PUBLIC_BASE_URL", (None, origin))[1].rstrip("/") not in {"", origin}:
    raise SystemExit("В серверном .env указан другой PUBLIC_BASE_URL.")
existing_pair = [current.get(key, (None, ""))[1] for key in pair]
if any(existing_pair) and not all(existing_pair) and any(
    value and value != prepared[key] for key, value in zip(pair, existing_pair)
):
    raise SystemExit(f"На сервере есть другая неполная пара {provider}. Проверьте её перед продолжением.")

added = []
for key in keys:
    index, value = current.get(key, (None, ""))
    if value:
        continue
    line = f"{key}={prepared[key]}\n"
    if index is not None:
        lines[index] = line
    else:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(line)
    added.append(key)

if added:
    metadata = target.stat()
    with NamedTemporaryFile(mode="w", dir=target.parent, prefix=".interhub-env-", delete=False) as temp:
        path = Path(temp.name)
        try:
            os.fchown(temp.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(temp.fileno(), metadata.st_mode & 0o777)
            temp.writelines(lines)
            temp.flush()
            os.fsync(temp.fileno())
            if target.read_text() != previous:
                raise SystemExit("Файл .env изменился во время операции. Повторите установку.")
            path.replace(target)
        finally:
            path.unlink(missing_ok=True)
    print("Записаны параметры " + ", ".join(added))
else:
    print(f"Параметры {provider} уже заданы.")
PY
```

Если сервер просит поправить окружение вручную, откройте действующий файл через `sudoedit /etc/interview-online/.env`. Для GitHub нужны `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_BASE_URL` и постоянный `SOCIAL_AUTH_FLOW_SECRET`. Данные берутся из приватного файла Mac.

## 4. Выложите и проверьте

На сервере выполните тот же блок при первой и каждой следующей выкладке.

```bash
set -euo pipefail
cd /opt/interview-online/repo
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
git pull --ff-only origin main
git rev-parse --short HEAD
```

Сверьте хеш с подготовленным коммитом, затем запустите выкладку из той же папки.

```bash
set -euo pipefail
bash deploy/scripts/deploy_docker.sh
curl -fsS https://interview.vtools.tech/healthz
curl -fsS https://interview.vtools.tech/api/auth/social/providers
```

Скрипт проверяет Compose, OAuth и ключ приглашений, подготавливает закреплённый архив draw.io, собирает образы и проверяет работу сайта и ресурсов холстов. Flyway применяет миграции при запуске backend. Для обычной выкладки используются действующие сертификаты. При ограниченном доступе сервера к GitHub есть отдельный маршрут переноса проверенного архива. [Сборка без доступа к GitHub](docs/deployment/REDEPLOY_BOTH_SERVERS_RU.md#архив-редактора-и-сборка-без-доступа-к-github)

В приватном окне браузера после первой выкладки проверьте следующее.

- [Страница входа](https://interview.vtools.tech/login) предлагает вход через GitHub. Возврат после авторизации открывает InterHub, обычный вход по паролю доступен.
- [Политика конфиденциальности](https://interview.vtools.tech/privacy) и [условия использования](https://interview.vtools.tech/terms) показывают текст документов. Код HTTP 200 сам по себе возможен и на главной странице.
- В тестовом аккаунте откройте библиотеку, наборы задач и комнату. Проверьте обучение на текущем экране, создание набора и переходы через «?». На сервере используйте тестовые данные.
- При первом обновлении с V42 миграция V46 создаёт отдельное хранилище прогресса версии 2. Существующие аккаунты получат вступление при первом входе в раздел, где доступно обучение. Прогресс версии 1 сохранится в истории.
- В Метрике проверьте поступление новых событий в счётчик `109032539`. В отчётах «Все действия · частота и посетители» и «После пропуска · возврат к обучению» фильтр `learning_version` должен включать `v2`. Действующие идентификаторы целей `learn_…_v1` используются и для событий версии 2. [Дашборд обучения](https://metrika.yandex.ru/dashboard?id=109032539&dashboardId=5dfcdf23-fc25-4186-846f-21b958adb13f)

Если перед InterHub есть отдельный HTTP-прокси, сохраните исключение журналирования кодов на OAuth callback и передачу SSE без буферизации. Встроенный nginx содержит эти правила. [Настройки внешнего прокси](specs/references/2026-11-18-learning-social-login-deploy.md#5-прокси-и-ресурсы-холстов)

## 5. Подключите Google после публикации

1. Убедитесь, что `/privacy` и `/terms` открываются по HTTPS без входа. В Google Auth Platform выберите проект `seraphic-plexus-515017-m7`. В **Branding** проверьте адреса документов и домен, затем выполните **Verify Branding** и **Publish branding**, если консоль предлагает эти действия. В **Audience** выберите **Publish app**, чтобы выйти из режима Testing. Публикация приложения и публикация бренда управляются отдельно. [Режимы OAuth в Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) · [Проверка бренда](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
2. Повторите серверный блок из раздела 3 с `google` вместо `github`. `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` появятся в действующем `.env`. Полная пара добавляет кнопку Google, поэтому выполните этот шаг после проверки готовности публичного входа.
3. Запустите `bash deploy/scripts/deploy_docker.sh` из `/opt/interview-online/repo`. Убедитесь, что [список провайдеров](https://interview.vtools.tech/api/auth/social/providers) содержит `google` и `github`. Проверьте вход через Google в приватном окне. После этого удалите приватную копию с сервера командой `rm -f -- "$HOME/.config/interhub/deploy/social-auth-production.env"`. На Mac оригинал остаётся доступным владельцу.

Если Google требует подтверждения домена или ручной проверки, GitHub и обучение можно выкладывать независимо. InterHub запрашивает базовые `openid profile`. Название и логотип на экране согласия зависят от состояния опубликованного бренда. [Требования Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)

## 6. Верните предыдущие образы при ошибке

Если сборка завершилась ошибкой до запуска контейнеров, сначала посмотрите `interhub_compose ps`. Если новая версия уже запущена, запишите путь резервного каталога в `INTERHUB_BACKUP` и используйте функцию `interhub_compose` из раздела 2. Команды возвращают предыдущие образы и настройки. Рабочий том PostgreSQL сохраняется.

```bash
test -s "$INTERHUB_BACKUP/server.env"
docker image load -i "$INTERHUB_BACKUP/previous-images.tar"
sudo sh -c 'set -eu
  umask 077
  interhub_tmp=$(mktemp "$2.rollback.XXXXXXXX")
  trap '\''rm -f -- "$interhub_tmp"'\'' EXIT
  cat "$1" > "$interhub_tmp"
  chown --reference="$2" "$interhub_tmp"
  chmod --reference="$2" "$interhub_tmp"
  mv -f -- "$interhub_tmp" "$2"' sh "$INTERHUB_BACKUP/server.env" /etc/interview-online/.env
interhub_compose -f "$INTERHUB_BACKUP/rollback-images.yml" config --quiet
interhub_compose -f "$INTERHUB_BACKUP/rollback-images.yml" up -d --no-build --no-deps backend web
interhub_compose ps
curl -fsS https://interview.vtools.tech/healthz
```

Если старый backend отказывается стартовать на новой схеме, восстановите текущую версию из сохранённых образов или повторите штатный деплой с текущим окружением. Откат БД разбирайте отдельно, поскольку восстановление старого дампа затрагивает данные, записанные после резервирования. [Подробнее об откате](specs/references/2026-11-18-learning-social-login-deploy.md#7-откат-с-сохранением-бд)
