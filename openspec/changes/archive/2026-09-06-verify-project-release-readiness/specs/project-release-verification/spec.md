## ADDED Requirements

### Requirement: Release decision reflects the complete inventoried test scope

The audit SHALL enumerate checked-in backend, frontend unit/contract/E2E and script tests, including tests missing from e2e:all. Each entry SHALL record its command, environment, exit status and evidence. A failed entry SHALL NOT stop independent entries from running or silently disappear from the report.

#### Scenario: A registered or unregistered runnable test exists

- **WHEN** the release test inventory is built from checked-in files and package scripts
- **THEN** every test entry point is run or assigned an explicit reason it cannot be executed
- **AND** retries retain the original failure and explain any harness correction

### Requirement: User-visible and production-sensitive behavior is verified

The audit SHALL cover authentication/accounts, task/room creation, role changes and HR tracking/export, interviews and authoring, logs/history/export, private data permissions, realtime concurrency/reconnect/refresh/step changes and negative authorization. It SHALL inspect production build/configuration and run available isolated fresh/upgrade PostgreSQL checks.

#### Scenario: The current candidate is exercised

- **WHEN** current sources are built and tested
- **THEN** the report identifies the source fingerprint, server/frontend mode, database version and browser used
- **AND** complete editor/log oracles, data isolation and migration preservation are evaluated rather than treating process exit alone as all-case coverage

### Requirement: Release recommendation preserves failures and unverified conditions

The audit SHALL distinguish GO, conditional GO and NO-GO. Confirmed critical user-data, authorization or migration defects SHALL block user deployment. Untested required production conditions or conflicting evidence SHALL be stated explicitly. The audit SHALL NOT claim exhaustive all-possible-case coverage from a finite suite.

#### Scenario: Tests or required conditions remain unresolved

- **WHEN** a required case fails or the available environment cannot verify it
- **THEN** the final decision lists the impact, evidence and release condition or blocking remediation
- **AND** no production deployment occurs during this verification task
