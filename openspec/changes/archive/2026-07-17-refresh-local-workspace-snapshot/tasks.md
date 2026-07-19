## 1. Test-first regression

- [x] 1.1 Extend the manager step-publication E2E with preview → publish → shared edit → another publication → restored-preview freshness assertions and the active-marker accessible-name assertion.
- [x] 1.2 Run the extended E2E red before production changes and record the obsolete cached preview failure.

## 2. Implementation

- [x] 2.1 Refetch the manager workspace snapshot whenever its non-published preview subscription is re-entered, without requesting data for candidates or the published task.
- [x] 2.2 Include the active task title in the global marker aria-label while keeping visible copy compact.

## 3. Verification

- [x] 3.1 Run the focused E2E, frontend typecheck/build and strict OpenSpec validation; mark tasks and archive the completed change.
