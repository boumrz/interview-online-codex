# Verification evidence

## Test-first RED — 2026-09-07

- Before changing either production component, `node --experimental-strip-types --test tests/unit/hiringManagerPreviewCopy.test.ts` exited with code 1. Its exact-copy assertion could not find `Проверяем нанимающего…`; the source still rendered `Проверяем нанимающего менеджера…`.
- Before changing either production component, `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm --prefix frontend run e2e:hr-cabinet` reached the authenticated room-create journey after its first two baseline scenarios passed. It then failed because `getByLabel("Нанимающие", { exact: true })` timed out in the empty-field scenario (line 242) and the debounce scenario (line 297). The old rendered source label was `Нанимающие менеджеры`, so this is the required observable-copy failure rather than a fixture or runtime failure.

## GREEN — 2026-09-07

- The focused source audit now passes: `node --experimental-strip-types --test tests/unit/hiringManagerPreviewCopy.test.ts` (1/1).
- The user-observable browser suite passes: `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm --prefix frontend run e2e:hr-cabinet` (33/33).
- Frontend regressions pass: `npm --prefix frontend run e2e:roles` and `npm --prefix frontend run e2e:account-binding`.
- Compatibility checks pass: `npm --prefix frontend run typecheck` and `npm --prefix frontend run build` (the build retains the pre-existing asset-size warnings only).
- Manual mutation fallback was used because the frontend has no Stryker configuration. Replacing the form label with `Нанимающие менеджеры` made the focused source audit fail; restoring `Нанимающие` made it pass again. Adding a final period to `Некорректный идентификатор нанимающего` also made the now quote-exact source audit fail; restoring the exact supplied literal made it pass again.
- `npx --yes @fission-ai/openspec@latest validate shorten-hiring-manager-preview-copy --strict` and `git diff --check` pass.
