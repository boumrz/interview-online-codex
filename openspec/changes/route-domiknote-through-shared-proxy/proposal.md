## Why

The production host currently routes both `domiknote.ru` and interview domains through the interview web container because its Nginx TLS vhost uses `server_name _`. This causes `domiknote.ru` to receive the interview certificate/app instead of the Finance Assistant service.

## What Changes

- Replace wildcard production Nginx vhosts with explicit domain vhosts.
- Keep interview traffic on the interview frontend/backend.
- Route `domiknote.ru` traffic to the Finance Assistant web container through a shared Docker network.
- Keep ACME HTTP challenge handling available for both products.
- Add deployment documentation for issuing/reusing certificates and connecting both services.

## Capabilities

### New Capabilities

- `shared-production-routing`: production Nginx routing for the two services hosted on the same server.

### Modified Capabilities

- None.

## Impact

- `frontend/nginx.docker.ssl.conf`
- `frontend/nginx.docker.http.conf`
- `frontend/docker-entrypoint.sh`
- `docker-compose.prod.yml`
- deployment env examples and docs/scripts
- production deployment process for shared proxy networking and certificate issuance
