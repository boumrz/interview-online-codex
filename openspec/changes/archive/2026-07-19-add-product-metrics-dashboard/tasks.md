## 1. Re-scope the delivery

- [x] 1.1 Remove the previously added frontend product-metrics route, page, client contract, browser test, backend API, configuration, tests, and deployment variables.
- [x] 1.2 Preserve the existing client-side Metrika tracking implementation and unrelated user worktree changes.

## 2. Standalone report generator

- [x] 2.1 Implement a local Node.js command with fixed Reporting API queries, period/output validation, read-only environment configuration, timeouts, and safe error handling.
- [x] 2.2 Generate a self-contained HTML report with traffic KPI cards, a daily SVG chart, data-quality indicators, and configured/unavailable product-event conversions.
- [x] 2.3 Ensure the generated artifact has no OAuth token, no live Metrika request, and no raw upstream error details.

## 3. Verification

- [x] 3.1 Add or update focused generator checks for validation, malformed data, token exclusion, and standalone HTML output.
- [x] 3.2 Run generator checks, project frontend/backend regression checks proportionate to removed code, and `openspec validate add-product-metrics-dashboard --strict`; update completed task checkboxes.
