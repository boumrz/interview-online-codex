# domain-migration-notice Specification

## Purpose
TBD - created by archiving change add-legacy-domain-notice-and-markdown-polish. Update Purpose after archive.
## Requirements
### Requirement: Legacy public domain warns before shutdown

The frontend SHALL show a global domain migration notice when the app is opened on `interview.domiknote.ru`.

#### Scenario: User opens the legacy production domain

- **WHEN** a user opens any route on `https://interview.domiknote.ru/`
- **THEN** the app shows a visible notice that `interview.domiknote.ru` will be disabled on July 26, 2026
- **AND** the notice tells users to switch domains so they can continue using the tool
- **AND** the notice offers a direct transition to `https://interview.vtools.tech/`

#### Scenario: Transition preserves the current route

- **WHEN** the notice is shown on a route such as `/room/abc?x=1#notes`
- **THEN** the transition link points to `https://interview.vtools.tech/room/abc?x=1#notes`

#### Scenario: New domain does not warn

- **WHEN** a user opens the app on `https://interview.vtools.tech/`
- **THEN** the legacy-domain notice is not shown

### Requirement: Legacy domain notice can be tested locally

The frontend SHALL provide a local test override for the legacy-domain notice without requiring hosts-file changes.

#### Scenario: Query flag enables local notice

- **WHEN** a tester opens localhost with `legacyDomainNotice=1`
- **THEN** the legacy-domain notice is shown even though the hostname is local

#### Scenario: Default localhost stays clean

- **WHEN** a tester opens localhost without a legacy-domain override
- **THEN** the legacy-domain notice is not shown

