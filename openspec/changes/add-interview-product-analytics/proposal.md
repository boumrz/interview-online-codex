## Why

The existing Metrika dashboard accurately describes browser traffic, but cannot show whether the platform helps interviewers prepare, run, and document successful technical interviews. Product decisions therefore lack trustworthy measures of interviewer activation, candidate attendance, decision capture, repeat use, and realtime reliability; the current instrumentation also needs privacy hardening before it is expanded.

## What Changes

- Add a server-authoritative, privacy-safe interview metrics read model and an authenticated aggregate API for product outcomes.
- Record durable lifecycle facts for room creation, candidate attendance, first technical activity, interview completion, and the first saved verdict; distinguish later verdict updates.
- Extend the local loopback dashboard with a product funnel, interviewer activation and retention, time-to-value, verdict-completion, and realtime health panels alongside the existing Metrika traffic context.
- Add a curated, source-labelled view of the existing Metrika action goals for acquisition, access, interview launch, and session reliability, with a compact diagnostic catalogue for the selected period.
- Add three documented, safe client Metrika conversion events (candidate join, first candidate activity, and verdict save) and configure the corresponding counter goals; retain existing detailed technical events as diagnostics rather than headline KPIs.
- Harden analytics collection by redacting invite routes and navigation targets, emitting stable error codes instead of raw messages, and disabling or masking Webvisor on interview-content routes.
- Add an event catalogue, payload allowlist, and focused automated checks so metric definitions cannot silently drift.

## Capabilities

### New Capabilities

- `interview-product-metrics`: Durable, aggregate-only measurement of the interview lifecycle, activation, completion, retention, and realtime health.
- `interview-product-metrics-dashboard`: Product-outcome panels and reading guidance in the local private dashboard.

### Modified Capabilities

- `analytics-tracking`: Safe, versioned client analytics collection and a documented set of Metrika conversion events.
- `live-metrika-analytics-dashboard`: The local dashboard adds clearly separated product aggregates while preserving traffic metrics and credential isolation.

## Impact

- Backend Kotlin models, migrations, lifecycle services, repositories, DTOs, and a protected aggregate endpoint.
- Frontend analytics wrapper, room flow event calls, route sanitisation, Webvisor behaviour, and tests.
- Local dashboard server/UI and its fixed aggregate contract.
- Existing Yandex Metrika counter goals, changed only through authenticated management requests; OAuth and Measurement Protocol secrets remain server- or local-process-only.
