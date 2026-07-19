## Context

The existing local dashboard fetches a fixed 30-day daily series, a current WAU/MAU, and a retention matrix. Its values are correct, but the header does not offer a period choice and the page does not clearly separate daily KPIs from a longer-period product view. The user asks to make the default view three months, select a period, and explain the results in plain Russian.

## Decisions

### Constrain the selectable period at the local server boundary

The only accepted values are 30 and 90 completed calendar days; absent `period` means 90. The page sends `period=30` or `period=90` to the existing same-origin endpoint. The server parses and validates that enum before any report work, returns 400 for every other value, duplicate query key, or unexpected query parameter, and never accepts dates, dimensions, filters, counter IDs, or metric names from the browser.

The fixed choices allow a clear default and prevent the endpoint becoming a general proxy for the Reporting API. The Node process remains loopback-only and continues to be the sole holder of the OAuth header.

### Give selected-period numbers their own meaning

In addition to the existing latest-completed-day DAU, current WAU, and current 30-day MAU, the server returns:

- `periodUsers`: `ym:s:users` distinct Metrika users across all selected completed days, fetched as one fixed aggregate instead of summing DAU;
- `periodNewUsers`: the sum of daily `ym:s:newUsers` over the selected period, valid because a first visit belongs to only one day;
- `averageDau`: arithmetic mean of the selected daily `ym:s:users` series;
- `activityComparison`: the average DAU in the recent half of the selected period compared with the early half. It is an observational within-period comparison, not a causal or year-over-year claim.

WAU and MAU retain their current, rolling definitions regardless of selected trend length. The UI must state that distinction.

### Adapt fixed report windows and cache by selected period

`createReportWindow` takes an allowed period length. The daily activity and first-visit retention reports cover that exact selected completed-day range. Retention checkpoints still use D0/D1/D7/D14/D30, and values without a mature return day remain "ещё рано" rather than zero.

The dashboard service holds a separate five-minute cache, stale fallback, in-flight refresh, and forced-refresh timestamp per allowed period. A forced refresh is rate-limited per period. This keeps a 30-day view from serving 90-day data and avoids duplicate requests when multiple browser actions choose the same period.

The Reporting API work is dispatched in fixed batches of no more than two concurrent requests. The retention matrix has at most 4,095 relevant date pairs for 90 days, so its fixed limit is 5,000; a `total_rows` value over that bound or a pagination indication is treated as incomplete data rather than rendered as a partial retention result. Both HTTP 420 and HTTP 429 map to the existing safe quota state.

### Explain in the order a product owner can act on

The top of the page first states the selected date range and a short plain-language period summary: audience size, new visitors, typical day, and whether the second half was busier or quieter than the first. It labels that as an observation, not a reason.

Next, the existing KPI cards explain their own windows. A visible "Как читать" guide directs the owner to: (1) selected-period summary, (2) the daily trend, (3) latest activity KPIs, and (4) retention. The glossary keeps source parameter names and limitations, including that Metrika users are browser-scoped visitors rather than guaranteed product accounts.

## Risks and mitigations

- A 90-day first-visit matrix can contain more aggregate rows → retain the fixed `limit=100000`, validate response shape, use one request per period, and cache the aggregate result.
- The selected-period audience may be mistaken for MAU → display both labels and explicitly say that MAU always means the last rolling 30 days.
- The comparison can be mistaken for proof of a feature effect → use neutral wording, show the two average values, and state that it does not establish a cause.
- More UI text can overwhelm the page → use a compact summary and numbered guide before the existing expandable technical glossary.

## Verification strategy

- Unit-test 30/90 windows, fixed query parameters, duplicate/invalid query handling, period cache isolation, period summary calculations, truncated-retention rejection, 420/429 quota handling, and no secret leakage.
- Manually validate a 90-day response against the authorised counter, record only aggregate figures, and confirm that switching periods changes the visible range while preserving current WAU/MAU definitions.
- Run focused tests, strict OpenSpec validation, and a browser check of the default 90-day experience.
