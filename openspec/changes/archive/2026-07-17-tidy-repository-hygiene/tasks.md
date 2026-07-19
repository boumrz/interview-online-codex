## 1. Hygiene workflow

- [x] 1.1 Create and validate the project-local `repository-hygiene` skill with mandatory inventory, reference, retention, deletion, and verification gates.
- [x] 1.2 Record the safe cleanup boundary: remove confirmed generated/debug artefacts while preserving `analytics/` and presentation assets pending a separate retention decision.

## 2. Test organization

- [x] 2.1 Move the frontend analytics contract test to `frontend/tests/contract/`, update its relative source path, and retain its named npm command.
- [x] 2.2 Move all official frontend E2E scripts to `frontend/tests/e2e/<area>/` and update every existing named npm command without expanding `e2e:all` coverage.
- [x] 2.3 Move dashboard Node tests to `scripts/tests/` and correct their core-module, UI-fixture, launcher, and wrapper relative paths.
- [x] 2.4 Remove only the two confirmed unreferenced ignored two-window debug scripts.

## 3. Generated-file and logging policy

- [x] 3.1 Update `.gitignore` for reproducible output and local Python/Office cache artefacts.
- [x] 3.2 Change `scripts/dev-up.sh` so normal local runs do not retain backend or frontend log files and remove transient PID metadata during shutdown.
- [x] 3.3 After checking for active processes, remove confirmed local logs, runner caches, generated browser recordings, debug screenshots/diffs, and rebuildable build output.

## 4. Verification

- [x] 4.1 Run the relocated Node contract and dashboard tests, frontend typecheck, and relevant package-command smoke checks.
- [x] 4.2 Confirm no official test scripts remain at the frontend root, no deleted debug file has a project reference, and no cleaned local artefact is reported by `git status`.
- [x] 4.3 Run strict OpenSpec validation and record the final cleanup result.
