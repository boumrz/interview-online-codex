# 1.6e — automated programme prototype verification

Команда (при запущенном static server из `prototypes/` на порту 4174):

```sh
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6e/automated-check.mjs
```

Результат: **PASS**.

- Viewport × zoom: 44/44.
- Representative screenshots: 20; geometry-valid: 20/20.
- Runtime/page errors: 0.
- Role permissions: PASS — MEMBER read-only; ADMIN/team OWNER manage; room creator uses resolved programme.
- NONE / first draft / published+draft / archive / restore / allowed initial discard: PASS.
- Version/provenance/future-only and explicit vacancy update: PASS.
- Duplicate/stale conflict without silent replacement: PASS.
- Mandatory foundation / extras / programmed room: PASS.
- 20 resize changes preserve draft values: PASS.
- Keyboard/focus/visual viewport emulation: PASS.

Machine-readable evidence: [report.json](report.json). Screenshots: [screenshots/](screenshots/). This is prototype-only evidence and does not replace AC-18/AC-19, INT-08, server authorization, atomicy or programme-integrity proof.
