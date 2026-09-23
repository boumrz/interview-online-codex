# TASK-5-04 — browser RED evidence

## Command and isolation

Working directory: `frontend/`

```sh
E2E_TEAM_MANAGEMENT_PORT=18096 E2E_TEAM_MANAGEMENT_WEB_PORT=15196 npm run e2e:team-management-settings
```

The launcher requires both environment variables, rejects `5173` and `8080`,
verifies that `18096` and `15196` are free before startup, starts separate
loopback backend/frontend processes, uses a disposable PostgreSQL 16 schema,
and drops that schema during its normal cleanup. The user's `:5173` / `:8080`
runtime was not used, restarted, or stopped.

## Assertion-level RED result

The isolated application and browser started successfully. The suite reached
the following missing-behaviour assertions (not a port, startup, migration, or
network failure):

| Scenario | Result |
| --- | --- |
| OWNER keyboard settings matrix | `P1_OWNER_RENAME_FIELD_MISSING`: expected the labelled `Название команды` field once, received `0` |
| ADMIN keyboard settings matrix | `P1_ADMIN_RENAME_FIELD_MISSING`: expected the labelled `Название команды` field once, received `0` |
| MEMBER safe read-only surface | passed; no audit request or management mutation was sent and no management state was persisted |
| OWNER transfer confirmation | `P1_TRANSFER_INITIATOR_MISSING`: expected `Передать владение командой` once, received `0` |
| Same-key retry and role-CAS draft flow | `P1_RETRY_RENAME_FIELD_MISSING`: expected the labelled `Название команды` field once, received `0` |
| Manager audit privacy/error/retry flow | `P1_AUDIT_CONTROL_MISSING`: expected `Аудит команды` once, received `0` |

Final TAP summary: `tests 6`, `pass 1`, `fail 5`, exit status `1`. The
failures are the intended pre-implementation RED result: the current settings
route is a staged placeholder and does not expose the required form, transfer,
or audit controls.

The immutable test input also contains the downstream keyboard-only assertions
for visible focus and 44px targets, named transfer confirmation/focus return,
no optimistic ownership claim, current-server authority refresh, same-key
lost-response retry, role-CAS draft preservation, audit retry/withholding, and
neutral `LEGACY_UNCLASSIFIED` rendering. Those steps are deliberately blocked
by the missing initiating controls until production tasks implement them.

## Reopened TASK-5-04 coverage additions

The same isolated command was re-run after adding the following frozen
assertions. The application and browser again started normally, used the
isolated ports and disposable schema, and reached the same missing-control
assertions above. The MEMBER flow remains GREEN (`pass 1`); final TAP remains
`tests 6`, `pass 1`, `fail 5`, exit status `1`.

- Each rename retry, role-CAS, ownership-transfer and audit flow now snapshots
  URL, `history.state`, `localStorage` and `sessionStorage` before and after.
  The test rejects newly persisted management keys/history data and every
  changed snapshot, plus the concrete team, target, draft, audit action/ID and
  idempotency values supplied by the respective flow.
- After a successful transfer, focus is required to move to the terminal
  status region once the former owner loses the transfer control.
- The intercepted audit page now feeds all nine public action codes and
  requires exactly these fixed Russian labels: `Команда создана`, `Приглашение
  выпущено`, `Приглашение принято`, `Приглашение отозвано`, `Приглашение
  перевыпущено`, `Команда переименована`, `Роль участника изменена`, `Владение
  командой передано`, and `Историческое действие без публичного кода`. Every
  corresponding raw code is forbidden from the rendered page; an audit error
  must still clear all prior labels before retry.

These added assertions are downstream of the same absent settings controls, so
they did not replace or mask the assertion-level RED evidence.
