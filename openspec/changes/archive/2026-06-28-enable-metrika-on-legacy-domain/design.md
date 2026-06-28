## Context

The frontend analytics service gates Yandex Metrika initialization by hostname. The counter ID is already hardcoded in the analytics service, and Rspack injects `VITE_METRIKA_ALLOWED_HOSTS` with a default host allowlist.

## Goals / Non-Goals

**Goals:**
- Allow the same Yandex Metrika counter on `interview.vtools.tech` and `interview.domiknote.ru`.
- Keep local development hosts blocked unless explicitly configured otherwise.
- Preserve the current counter ID and tracking API calls.

**Non-Goals:**
- No Yandex Metrika counter ID change.
- No backend, routing, or consent-flow changes.
- No analytics event taxonomy changes.

## Decisions

- Keep host gating in the frontend analytics service because it already owns counter initialization.
- Update both the service fallback and Rspack default for `VITE_METRIKA_ALLOWED_HOSTS`; this keeps production builds correct whether the env var is absent or injected by the bundler.
- Add a focused E2E script that serves the app through Playwright with synthetic production hostnames, intercepts the Metrika script request, and verifies that both production domains initialize the counter while localhost remains blocked.

## Risks / Trade-offs

- [Risk] Production environment can override `VITE_METRIKA_ALLOWED_HOSTS` with only one host. Mitigation: document and test the two-host default; deployment config should not narrow it accidentally.
- [Risk] E2E should not call the real Metrika network endpoint. Mitigation: intercept the script URL and fulfill it with a local stub.
