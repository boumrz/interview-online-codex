# Restore local registration CORS access

## Why

The current local backend process permits `http://localhost:5173` but rejects
`http://127.0.0.1:5173` with `403 Invalid CORS request`. The frontend may be
opened by either standard local hostname, so registration fails before reaching the
authentication controller.

An environment override for `CORS_ORIGINS` currently replaces the whole default
list, allowing a stale single-origin value to remove the other supported local
origin.

## Scope

- Preserve `localhost:5173` and `127.0.0.1:5173` as always-supported local
  frontend origins for `/api/**`.
- Treat configured `CORS_ORIGINS` values as additional origins rather than a
  replacement for those local defaults.
- Prove the registration preflight and request work from both standard local
  origins.

## Out of scope

- Broad wildcard CORS origins.
- Changing authentication validation or registration policy.
