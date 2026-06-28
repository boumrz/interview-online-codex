## Context

The frontend is a React/Rspack SPA with all routes mounted from `App.tsx`. A domain-level notice must be route-independent, so it should render outside the route switch and above the lazy page content.

Rspack already injects environment-driven constants through `DefinePlugin`, making compile-time domain configuration straightforward.

## Goals / Non-Goals

**Goals:**

- Show the notice only on the legacy domain or when a local test flag is enabled.
- Preserve path/search/hash when generating the new-domain URL.
- Keep the banner non-blocking but visually obvious.
- Make local manual testing possible without editing hosts files.
- Keep markdown polish small and behavior-preserving.

**Non-Goals:**

- Do not redirect automatically.
- Do not change backend CORS or deployment certificates.
- Do not add persistence for dismissing the notice.
- Do not change markdown insertion behavior.

## Decisions

### Add `LegacyDomainNotice`

Create a small component under `frontend/src/components/LegacyDomainNotice.tsx`. It evaluates:

- `window.location.hostname === legacyDomain`
- `process.env.VITE_SHOW_LEGACY_DOMAIN_NOTICE === "true"`
- query params `legacyDomainNotice=1` or `showLegacyDomainNotice=1`
- localStorage `showLegacyDomainNotice=1`

When active, it renders a top-of-app notice with a link to the new domain plus the current path/search/hash.

### Use build-time defaults

Add Rspack constants:

- `VITE_LEGACY_PUBLIC_DOMAIN`, default `interview.domiknote.ru`
- `VITE_NEW_PUBLIC_DOMAIN`, default `interview.vtools.tech`
- `VITE_LEGACY_DOMAIN_SHUTDOWN_DATE`, default `2026-07-26`
- `VITE_SHOW_LEGACY_DOMAIN_NOTICE`, default `false`

### Markdown polish remains local to `BriefingBoard`

Remove the CodeMirror placeholder extension and render the fenced-code toolbar button as `Code`. Keep the inserted snippet as:

```md
```ts
// code
```
```

## Risks / Trade-offs

- [Risk] A global banner could alter vertical layout. -> Mitigation: render it before route content with compact responsive styling.
- [Risk] Query flag could remain in copied links. -> Mitigation: it only affects local/manual rendering; production behavior is host-based.
- [Risk] LocalStorage flag could surprise a tester later. -> Mitigation: document the key in tests and final summary.
