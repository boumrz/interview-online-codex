## 1. Bounded authorization recovery

- [x] 1.1 Add a red browser regression that simulates repeated `403` relay responses and asserts that the room becomes non-editable and event requests stop after the bounded recovery attempt.
- [x] 1.2 Add a red candidate-invitation regression proving that an anonymous candidate receives the interactive workspace only after `state_sync` and does not receive interviewer controls.
- [x] 1.3 Add terminal authorization handling to the realtime client: close transport, abort requests, clear queue, and report the access error after a second `403` for the same queued event.
- [x] 1.4 Gate the editable room UI on a confirmed realtime `state_sync` and render a clear non-editable access state after terminal authorization failure.
- [x] 1.5 Run the focused browser regressions, relevant backend authorization tests, frontend typecheck/build, and strict OpenSpec validation.
