## 1. Test-first acceptance coverage

- [x] 1.1 Update the focused three-browser E2E to require the `Активен` marker, the `Сделать активным` publication action, and the absence of the local-preview card, its explanatory copy, and new border treatment.
- [x] 1.2 Run the focused E2E before the UI implementation and record the expected failure: `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://127.0.0.1:8080/api E2E_BROWSER_API_ORIGIN=http://127.0.0.1:8080 npm run e2e:step-publication` failed with `OWNER_INITIAL_GLOBAL_MARKER_LABEL_MISMATCH`, because the old UI still renders `Активно для всех`.

## 2. Compact manager step controls

- [x] 2.1 Replace the preview card and repeated shared-task line with the compact active-step context and a row-attached publication action.
- [x] 2.2 Apply the researched Russian labels, retain semantic/accessible room-wide context, and keep candidates without publication controls.
- [x] 2.3 Remove the new local-selection and active-marker borders while retaining clear selected-row and active-task states.

## 3. Verification

- [x] 3.1 Run the focused E2E and the existing independent-navigation regression green: `npm run e2e:step-publication` and `npm run e2e:room` passed against the local frontend and backend.
- [x] 3.2 Run frontend typecheck/build, strictly validate the OpenSpec change, and record completed tasks: `npm run typecheck` and `npm run build` passed.
