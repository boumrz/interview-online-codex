# hr-room-export Specification

## Purpose
Let an authenticated HR manager download an Excel workbook containing only the retained interview records that the account is currently permitted to oversee.

## Requirements

### Requirement: HR export produces a real server-authorized Excel workbook

The system SHALL offer an `.xlsx` download to authenticated accounts whose stored `isHr` value is true. Export SHALL derive its account scope from server-authenticated identity and include only that account's currently permitted tracked rooms, including authorized archived records. It SHALL NOT accept a client-selected HR account as an authorization substitute. A non-HR account, including one with interviewer permission, SHALL be denied this cross-room HR export. Successful output SHALL be a valid Office Open XML workbook, not CSV/HTML renamed as `.xlsx`, and SHALL carry the appropriate download filename and content type. Export SHALL cover the complete requested scope rather than only a visible cabinet page.

Pre-implementation acceptance-test level: **E2E** for browser download and separation between two HR accounts; supplemented by a **backend integration exception** for authentication/authorization attempts and parsing the downloaded workbook as OOXML.

#### Scenario: HR downloads all tracked interviews

- **WHEN** an HR account requests export without date filters
- **THEN** the downloaded workbook contains every retained tracked interview the account is currently authorized to review exactly once
- **AND** it excludes unassigned rooms, candidate-only rooms, and tracked rooms for which permission was lost

#### Scenario: Ordinary interviewer requests HR export directly

- **WHEN** an authenticated non-HR interviewer invokes the HR export operation directly
- **THEN** the server denies the operation without generating an interview workbook

#### Scenario: Export scope exceeds the visible page

- **WHEN** permitted interviews span multiple cabinet pages and HR downloads the current date scope
- **THEN** the workbook includes all matching authorized interviews across those pages with no silent truncation

### Requirement: Optional date range uses one visible and deterministic date basis

Export SHALL default to all retained time. An optional filter SHALL accept either both inclusive calendar boundaries or neither; partial, malformed, or reversed ranges SHALL produce a validation error. The interview's filtering date SHALL use `scheduledAt` when present, otherwise its first completion timestamp when present, otherwise creation time. Calendar conversion and boundaries SHALL use the explicitly displayed timezone selected in the approved design, consistently in the cabinet, filter explanation, and workbook. Future scheduled dates SHALL be supported. Each exported row SHALL identify which date source was used, so missing schedule data does not masquerade as a planned interview. The workbook SHALL record the selected range or all-time mode and the timezone.

Pre-implementation acceptance-test level: **E2E** for selecting/clearing a period and visible date explanation; supplemented by a **backend integration exception** for exact midnight boundaries, fallback precedence, future schedules, invalid ranges, and stable completion dates after verdict edits.

#### Scenario: HR filters a period containing scheduled and legacy rooms

- **WHEN** HR exports an inclusive period with scheduled, completed-unscheduled, and unfinished-unscheduled tracked interviews
- **THEN** inclusion follows scheduled date, otherwise first completion date, otherwise creation date in the documented timezone
- **AND** every row states its actual date source and the workbook records the chosen period

#### Scenario: HR clears a date filter

- **WHEN** HR clears both date boundaries and exports
- **THEN** the workbook returns to all retained authorized history rather than an implicit recent-time window

#### Scenario: Filter boundaries are incomplete or reversed

- **WHEN** an export request provides one boundary only, an invalid calendar date, or an end before the start
- **THEN** the request is rejected with recoverable validation feedback and no partial workbook

### Requirement: Workbook exposes the agreed interview summary without private content

The workbook SHALL provide one interview summary row per room with its stable interview identifier, candidate name, position, scheduled time, creation time, first completion time, interview state, archived indicator, current verdict and verdict comment, and effective filter date/source. Existing task scores SHALL be included with their task identity, using a separate detail sheet if more than one task belongs to an interview, so summary rows remain unique. Missing values SHALL remain explicitly unspecified or empty with a documented legend. The export SHALL NOT include another interviewer's private notes, raw candidate activity, session credentials, authentication tokens, or candidate invitation secrets. All user-controlled text SHALL be written as literal cell values rather than spreadsheet formulas or executable external links.

Pre-implementation acceptance-test level: **E2E** for downloadable visible interview results, supplemented by a **backend integration exception** for workbook schema, multi-task scores, Unicode/newlines, formula-like values, and absence of prohibited fields.

#### Scenario: Interview contains multiple scores and a multiline verdict comment

- **WHEN** HR exports an authorized interview with several scored tasks and a Unicode/multiline verdict comment
- **THEN** the workbook retains one summary row, the current comment, and each existing task score linked to that interview
- **AND** missing scores do not become invented zeroes or an inferred hiring assessment

#### Scenario: A candidate name resembles a spreadsheet formula

- **WHEN** candidate name, position, or verdict comment begins with a formula-like prefix
- **THEN** the workbook stores the exact content as text without an executable formula or external-link relationship

### Requirement: Export failures and empty results are explicit and recoverable

An empty authorized result SHALL produce a valid workbook with column headings and range/timezone metadata, accompanied by clear empty-result feedback. The UI SHALL expose pending, successful download, and recoverable failure states without claiming that a failed or partial generation succeeded. Generation SHALL recheck server-side authorization as part of obtaining its data and SHALL not depend on active room streams or initiate room connections for every exported record. The design and verification evidence SHALL document the supported workload and generation bounds; implementation SHALL avoid silently dropping rows to satisfy those bounds.

Pre-implementation acceptance-test level: **E2E** for empty/pending/failure states, supplemented by a **backend integration exception** for consistent authorization and complete generation over the documented workload.

#### Scenario: No interview matches the requested period

- **WHEN** HR exports a valid period with no matching permitted interviews
- **THEN** the download remains a valid workbook with no interview data rows and with its headings/range/timezone
- **AND** the UI identifies the empty result

#### Scenario: Workbook generation fails

- **WHEN** the server cannot complete export generation
- **THEN** the UI reports a recoverable failure and does not offer a successful partial workbook
- **AND** the error contains no raw credentials, unrelated interview content, or implementation stack trace
