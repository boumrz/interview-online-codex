## Why

The legacy-domain shutdown notice currently says users can continue using rooms and the personal cabinet. The requested wording should be broader and refer to continuing to use the tool.

## What Changes

- Update the legacy-domain notice body copy to say that switching domains lets the user continue using the tool.
- Keep the shutdown date, old domain, new domain, and local test override behavior unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `domain-migration-notice`: updates the required notice copy for the domain migration message.

## Impact

- Frontend copy in the legacy-domain notice component.
- E2E coverage for the legacy-domain notice copy.
