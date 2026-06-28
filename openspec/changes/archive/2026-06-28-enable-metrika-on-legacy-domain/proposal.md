## Why

Yandex Metrika should keep tracking traffic on both the new production domain and the legacy production domain during the migration period. The counter ID is unchanged, but the frontend allowlist currently defaults to only the new domain.

## What Changes

- Allow the existing Yandex Metrika counter to initialize on `interview.vtools.tech`.
- Allow the same counter to initialize on `interview.domiknote.ru`.
- Keep local development hosts blocked by default.

## Capabilities

### New Capabilities

- `analytics-tracking`: controls when the frontend initializes Yandex Metrika and sends analytics events.

### Modified Capabilities

- None.

## Impact

- Frontend analytics service domain allowlist.
- Rspack environment default for `VITE_METRIKA_ALLOWED_HOSTS`.
- Focused E2E coverage for analytics host gating.
