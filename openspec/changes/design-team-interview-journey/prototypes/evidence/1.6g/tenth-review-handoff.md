# 1.6g tenth review handoff — iPhone Safari orientation fallback

Status: **automated PASS; real Mobile Safari review pending**. This remains a prototype-only UX artifact and does not prove production browser detection, mutation prevention or server authorization.

## Accepted MVP boundary

- Mobile Safari on iPhone: native input is supported in portrait.
- Landscape with the keyboard closed remains supported for viewing and navigation with targets at least 44×44 CSS px.
- Native landscape input is not supported. Before focus, the prototype shows «Для ввода поверните iPhone вертикально» and does not open the keyboard or submit.
- Rotating a focused portrait input to landscape preserves local state, blurs without send/submit and shows the same fallback after viewport settle.
- Returning to portrait preserves the surface and draft but requires a new explicit focus.
- No claim is made for another mobile browser/device.

## Automated evidence

`mobile-safari-orientation-fallback-check.mjs` is GREEN:

```json
{"pass":true,"direct":"6/6","rotate":"6/6","otherBrowser":true,"pageErrors":0}
```

Representative surfaces: DA-01 profile, DA-02 task edit, DA-03 room chat, DA-04 hiring filter, DA-05 programme-backed interview creation and DA-06 exact merge target. Assertions cover exact copy, pre-focus interception, no mutation/hash change, draft/selection preservation, room session/editor/panel/step/scroll continuity, explicit portrait re-focus, both horizontal safe-area directions, visible targets ≥44px and usable room navigation while fallback is shown.

## Required real Safari checks

1. In portrait, focus and edit the room composer and one compact form normally.
2. In both landscape directions with keyboard closed, confirm viewing/navigation and 44px targets.
3. Tap a text field directly in landscape: keyboard must not open; fallback must be announced and fully inside safe area; draft/scope must not change.
4. Start input in portrait, then rotate to landscape: keyboard closes, no Send/submit occurs, fallback appears after settle, and draft/session/context/local step/selection/scroll remain.
5. Return portrait: fallback disappears, state remains, and keyboard stays closed until a new explicit tap.

The ninth-run screenshots and failed scroll-runway record remain in this directory as historical evidence for the Product Owner's support-matrix change, not as a current blocker description.
