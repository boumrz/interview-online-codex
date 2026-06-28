## Context

The server currently exposes `80` and `443` from `interview-online-web`. Its Nginx TLS config uses `server_name _` and the interview certificate, so traffic for `domiknote.ru` is accepted by the interview container before the Finance Assistant container can handle it. Finance Assistant already has a Docker stack whose `web` service can join the external `domiknote_proxy` network.

## Goals / Non-Goals

**Goals:**
- Make `interview-online-web` usable as the temporary shared reverse proxy for both products.
- Remove wildcard serving of the interview app.
- Route `domiknote.ru` to `finance-assistant-web-1:80` through a configurable upstream.
- Keep interview routes, `/api`, `/ws`, `/api/realtime`, and `/healthz` behavior unchanged.
- Keep certbot HTTP-01 validation reachable through `/var/www/certbot`.

**Non-Goals:**
- No Finance Assistant application code changes.
- No migration to a separate host-level reverse proxy in this change.
- No production secret or DNS changes in repository code.

## Decisions

- Use explicit Nginx `server_name` values for finance and interview domains. This fixes the current `server_name _` failure mode and keeps unknown hosts from serving interview UI.
- Keep the interview SSL certificate path controlled by `DOMAIN`; deployment can point it at a cert whose SAN covers `interview.vtools.tech` and `interview.domiknote.ru`.
- Add `FINANCE_DOMAIN`, `FINANCE_CERT_DOMAIN`, and `FINANCE_WEB_UPSTREAM` runtime variables for the finance vhost.
- Use `proxy_pass http://$finance_web_upstream` with Docker DNS resolver `127.0.0.11`; this lets Nginx start even if the Finance Assistant container is temporarily absent, while finance requests return an upstream error until the container is available.
- Add a compose override for the shared proxy network instead of forcing every standalone interview deployment to depend on an external `domiknote_proxy` network.
- Keep certbot volume writes in the existing `certbot` service. The web container only needs read access to serve challenge files.

## Risks / Trade-offs

- [Risk] `domiknote.ru` HTTPS block requires `/etc/letsencrypt/live/domiknote.ru`. Mitigation: document and script cert issuance before enabling the vhost in production.
- [Risk] Production env may still set only the legacy interview domain in `DOMAIN`. Mitigation: document `INTERVIEW_SERVER_NAMES` and certificate checks for both interview domains.
- [Risk] Finance upstream name can differ by compose project. Mitigation: expose `FINANCE_WEB_UPSTREAM` and default it to `finance-assistant-web-1:80`.

## Migration Plan

1. Create or reuse the external Docker network `domiknote_proxy`.
2. Start Finance Assistant web on `domiknote_proxy`.
3. Issue certificates for `domiknote.ru` and the interview domain set using the interview certbot service.
4. Deploy interview web with the shared proxy override and environment variables.
5. Verify:
   - `curl -Ik https://domiknote.ru/`
   - `curl -fsS https://domiknote.ru/api/health`
   - `curl -Ik https://interview.vtools.tech/`
   - `curl -Ik https://interview.domiknote.ru/`

## Rollback

Revert the Nginx template or disable the shared proxy override, then reload/recreate `interview-online-web`. Do not restore a wildcard TLS vhost for `domiknote.ru`; if finance must be temporarily disabled, return a maintenance response for that domain instead.
