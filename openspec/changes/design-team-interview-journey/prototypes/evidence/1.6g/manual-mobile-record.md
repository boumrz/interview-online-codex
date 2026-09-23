# 1.6g tenth re-review — real Mobile Safari record

Verdict: **PASS / `ux-approved`**. The Product Owner's portrait-only iPhone Safari input boundary is explicit and usable. Portrait input works; keyboard-closed landscape remains usable for viewing/navigation; direct landscape input is intercepted before focus; rotating a focused portrait field closes input without submit and preserves state.

## Environment

| Field | Value |
|---|---|
| Date | 2026-09-09, 15:28–15:47 Europe/Moscow (12:28–12:47 UTC) |
| Browser/runtime | Mobile Safari 26.2 (`8623.1.14.10.9`), iOS Simulator 26.2 (`23C54`) |
| Device | iPhone 17 Pro `0A8ABE46-E851-46AE-AC5D-361B1E3F14F0`; DPR 3; nominal 402×874 CSS px |
| Captures | Portrait 1206×2622 device px; landscape normalized to 2622×1206 device px |
| URL | Fresh cache-busting `?uxg=tenth-*` URLs on `http://192.168.1.125:4173/` |
| Input harness | Real Safari/WebKit focus and visual viewport; Simulator keyboard bridge was used to enter `10`. Safari's native input accessory and focus geometry were visible. |

## Real-browser matrix

| Case | Result | Observation | Evidence |
|---|---|---|---|
| Room portrait, input focused | PASS | Chat, local/published step, focused textarea and Send remain reachable. Draft was edited at the active selection before rotation. | `screenshots/ios-safari-tenth-room-portrait-input-focused-before-rotate.png` |
| Room landscape right, keyboard closed | PASS | Six navigation targets, current/published step, bounded history, textarea and Send are visible; no horizontal overflow. | `screenshots/ios-safari-tenth-room-landscape-right-keyboard-closed-upright.png` |
| Room landscape left, keyboard closed | PASS | Same viewing/navigation layout with Dynamic Island on the opposite safe-area edge. | `screenshots/ios-safari-tenth-room-landscape-left-keyboard-closed-upright.png` |
| Room direct landscape tap, both directions | PASS | Tap on the textarea does not focus or open input. Exact fallback appears, entirely inside the horizontal safe area, with a 44px `Понятно` action. | `screenshots/ios-safari-tenth-room-landscape-right-direct-fallback-upright.png`, `screenshots/ios-safari-tenth-room-landscape-left-direct-fallback-upright.png` |
| Room navigation while fallback is shown | PASS | Editor opens from the first 44px nav target and Chat returns from its 44px target; fallback does not block navigation. | Same direct-fallback captures plus manual Editor→Chat action observation |
| Room portrait → landscape during input | PASS | Native input closes, fallback appears after settle, no message is sent, and Chat/current step/draft remain. The inserted `10` remains at the original selection. | `screenshots/ios-safari-tenth-room-landscape-right-rotate-fallback-upright.png` |
| Room return portrait | PASS | Fallback disappears, Chat/current step/draft remain, keyboard stays closed until a new explicit tap, then the same textarea refocuses. | `screenshots/ios-safari-tenth-room-portrait-return-explicit-refocus.png` |
| Profile compact form portrait | PASS | Account-name field focuses and accepts input. | `screenshots/ios-safari-tenth-profile-portrait-return-explicit-refocus.png` |
| Profile compact form landscape, both directions | PASS | Direct field taps are intercepted before input in both Dynamic Island directions; exact fallback remains safe and draft `Анна Крылова 10` is unchanged. | `screenshots/ios-safari-tenth-profile-landscape-right-direct-fallback-upright.png`, `screenshots/ios-safari-tenth-profile-landscape-left-direct-fallback-upright.png` |
| Profile portrait → landscape during input | PASS | Focus closes without Save; edited value/scope remain and fallback appears. | `screenshots/ios-safari-tenth-profile-landscape-right-rotate-fallback-upright.png` |

## State, accessibility and policy checks

- Draft, active room panel, current/published step, unread/history position and profile scope remained stable across rotation. No Send or Save mutation occurred.
- Returning portrait did not auto-focus either field; a new direct tap was required and succeeded.
- Fallback copy is exactly `Для ввода поверните iPhone вертикально`; the implementation exposes it as `role="alert"`, `aria-live="assertive"`, and gives the close action an accessible name. The exact copy and button were visually present in real Safari.
- Six room navigation cells and fallback action are at least 44×44 CSS px. At DPR 3, a 44px nav row is 132 device pixels in the captures.
- Both horizontal safe-area directions pass; fallback and content do not collide with Dynamic Island. No horizontal overflow or document scroll was observed.
- Publish remains available only to server-confirmed room OWNER/INTERVIEWER with active room authority. Candidate, hiring, guest-manager and team labels without room grant remain denied by the independent actor replay.
- This evidence claims Mobile Safari 26.2 on the stated iPhone simulator only. No other mobile browser/device is claimed.

## Automated replay

Fresh replay on the reviewed prototype: 1.6a–1.6f all PASS at 44/44 with zero runtime errors and expected screenshot counts; orientation fallback DA-01–DA-06 is 6/6 direct + 6/6 rotation with the non-Safari negative control passing. `openspec validate design-team-interview-journey --strict` passes.
