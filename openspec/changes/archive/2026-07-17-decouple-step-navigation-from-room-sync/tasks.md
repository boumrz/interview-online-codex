## 1. Test-first acceptance coverage

- [x] 1.1 Add the three-browser Playwright E2E for independent owner/interviewer selections, explicit room-wide publication, candidate UI and direct-server restrictions, local-selection state, accessible global-active markers, and the candidate's unchanged published task; add `e2e:step-publication` to the frontend scripts.
- [x] 1.2 Run the new E2E before production changes and record its expected failure: `E2E_BASE_URL=http://127.0.0.1:5173 E2E_API_URL=http://127.0.0.1:8080/api npm run e2e:step-publication` reached the room UI and failed at `room-global-active-step-0`, because the required global marker and separate publication controls do not exist before implementation.

## 2. Independent interviewer navigation

- [x] 2.1 Add manager-local selected-step state persisted within the browser session, seeded from the published room step only when no valid selection exists, without emitting a realtime event for normal task-row selection.
- [x] 2.2 Update the manager task-list and working-task presentation to distinguish local selection from the unique “Активно для всех” task, with accessible labels and stable E2E selectors.
- [x] 2.3 Add the separate manager-only “Показать этот шаг всем” action that uses the existing authorized room-wide `set_step` operation; keep candidates without local navigation or publication controls.
- [x] 2.4 Keep shared editor, language, briefing, ratings, and Yjs synchronization bound to the published room-wide step while a manager previews another task locally.

## 3. Verification

- [x] 3.1 Run the new E2E green plus the existing room step/language and role-regression E2E coverage: `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://127.0.0.1:8080/api E2E_BROWSER_API_ORIGIN=http://127.0.0.1:8080 npm run e2e:step-publication`, `npm run e2e:room-language`, and `npm run e2e:roles` passed.
- [x] 3.2 Run frontend typecheck/build and relevant backend tests; strictly validate the OpenSpec change and record completed tasks: `npm run typecheck`, `npm run build`, and `backend\\mvnw.cmd -Dtest=RoomAccessServiceTest test` passed.
