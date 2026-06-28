# analytics-tracking Specification

## Purpose
TBD - created by archiving change enable-metrika-on-legacy-domain. Update Purpose after archive.
## Requirements
### Requirement: Yandex Metrika runs on production migration domains

The frontend SHALL initialize the existing Yandex Metrika counter on the accepted production domains and SHALL keep local development hosts blocked by default.

#### Scenario: New production domain initializes Metrika

- **WHEN** the app is opened on `https://interview.vtools.tech/`
- **THEN** the frontend initializes the Yandex Metrika counter
- **AND** page views and goals can be sent through that counter

#### Scenario: Legacy production domain initializes Metrika

- **WHEN** the app is opened on `https://interview.domiknote.ru/`
- **THEN** the frontend initializes the same Yandex Metrika counter
- **AND** page views and goals can be sent through that counter

#### Scenario: Localhost stays blocked by default

- **WHEN** the app is opened on `http://localhost`
- **THEN** the frontend does not initialize Yandex Metrika by default

#### Scenario: Counter identity stays unchanged

- **WHEN** analytics is initialized on either accepted production domain
- **THEN** the frontend uses the existing Yandex Metrika counter ID

