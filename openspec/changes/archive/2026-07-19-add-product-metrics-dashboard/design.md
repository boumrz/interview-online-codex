## Context

The frontend emits page views and named product events to the existing Yandex Metrika counter, but no report surface is needed inside the product. A generated local HTML file lets the owner inspect a concise snapshot in any browser while keeping analytics access outside the deployed application.

## Goals / Non-Goals

**Goals:**

- Generate a single standalone HTML file containing fixed traffic metrics, a daily SVG trend, product-goal conversions, dates, and sampling/data-lag indicators.
- Use the Reporting API only at generation time and leave no token, API URL request, or credential in the generated file.
- Support 7-day, 30-day, and 90-day snapshots and save reports under ignored `analytics/` by default.
- Clearly label a product event as unavailable when its numeric Metrika goal ID was not supplied.

**Non-Goals:**

- Adding a route, page, authentication flow, backend API, server cache, deployment secret, or database model to interview-online.
- Replacing the Metrika interface, serving a live dashboard, or emitting a report with raw visit-level data.
- Automating OAuth consent or refresh-token lifecycle; the report owner supplies a read-only token for the local command.

## Decisions

### Generate an autonomous file instead of a product page

Implement `node scripts/generate-metrika-dashboard.mjs`. It writes `analytics/metrika-dashboard-<YYYY-MM-DD>.html` unless `--out` provides another location. The generated file embeds only normalised aggregate data and inline CSS/JavaScript/SVG, so it can be opened with a browser without a web server or later Metrika request.

### Keep the Reporting API calls fixed and local

The generator reads `METRIKA_OAUTH_TOKEN`, `METRIKA_COUNTER_ID` (defaulting to the existing counter), `METRIKA_TIMEZONE`, and optional `METRIKA_GOAL_*` variables from its process environment. It calls `/stat/v1/data/bytime` for daily users, sessions, and page views, and `/stat/v1/data` for traffic totals plus approved `ym:s:goal<ID>visits` metrics. The fixed funnel maps only to events already emitted by the client: `mkt_register_success`, `prod_guest_room_create_success`, `prod_room_create_success`, `prod_room_opened`, `prod_first_code_edit`, `prod_second_participant_joined`, `prod_note_sent`, and `prod_room_error`. It accepts only `--period=7d|30d|90d` and `--out`; users cannot turn it into an arbitrary upstream query proxy.

### Fail safely rather than write misleading figures

The generator uses request timeouts, rejects malformed or incomplete successful API responses, and exits without writing a report when Metrika cannot be reached. It does not log the token or include raw upstream error text. Sampling fraction and data lag are preserved in the report; goals without mappings are marked unavailable instead of zero.

### Remove deployed dashboard work

Remove the new frontend route, components, RTK Query types, backend adapter/controller/configuration/tests, deployment variables, and E2E scenario added for the earlier interpretation. Existing analytics collection remains unchanged.

## Risks / Trade-offs

- [Token is supplied through a terminal environment] → Keep it process-local, never place it in a `.env` committed to the repository, and do not embed it in the HTML.
- [Configured goals are unknown] → The report works for traffic first and labels each unmapped funnel event as requiring a numeric Metrika goal ID.
- [Metrika data is sampled, delayed, or temporarily unavailable] → Display metadata when available; otherwise stop with a safe error rather than create a stale or fabricated snapshot.
- [Static report is not live] → Regenerate it whenever a fresh view is needed; this is intentional for a portable personal file.
