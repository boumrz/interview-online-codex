## Purpose

Give an authenticated room creator timely, privacy-safe feedback about invitation UUIDs before room creation. The feedback reduces avoidable failed submissions without turning a directory lookup into account discovery or authorization.

## ADDED Requirements

### Requirement: The personal room-creation form previews complete hiring-manager invitation UUIDs

The authenticated personal-dashboard room-creation form SHALL retain the existing optional “Нанимающие менеджеры” draft field and SHALL show a separate, accessible result for every distinct normalized complete UUID currently present in that field. A UUID becomes eligible for remote resolution only after it is syntactically complete and remains unchanged for the form's bounded debounce interval; incomplete draft fragments SHALL not be sent for lookup and SHALL not be represented as “not found”. Repeated, case-varied, or delimiter-separated occurrences of the same UUID SHALL share one prospective-target result and SHALL NOT cause duplicate concurrent lookup requests.

While an eligible UUID is being resolved, the form SHALL identify it as `Проверяем нанимающего менеджера…` without blocking ordinary draft editing. If the authenticated lookup confirms an eligible hiring-manager account, the result SHALL identify the prospective assignment as `Будет добавлен: {displayName}`. This message SHALL NOT imply that a room, membership, or tracked association already exists. If the UUID is unknown, belongs to an account that is not currently eligible, or cannot be used for this purpose, the result SHALL instead display the exact generic Russian message `Нанимающий менеджер не найден или недоступен`, without a display name or account classification. A syntactically incomplete or malformed final token SHALL receive the exact local format-completion message `Введите полный UUID нанимающего менеджера`; it SHALL not start a remote lookup or claim that an account was found or unavailable. An unexpected preview availability failure SHALL instead display the exact generic retryable message `Не удалось проверить нанимающего менеджера. Повторите попытку.`, without a target name, unavailable classification, database detail, or error implementation detail.

The form SHALL replace or remove obsolete result states as the associated UUID token is edited, deleted, or deduplicated. A response that arrives after a token, request generation, authenticated account, or page context has changed SHALL NOT reintroduce an obsolete name, error, or prospective assignment. The preview SHALL remain optional feedback: it SHALL not create a membership or tracked association, change the raw draft, navigate, or report that the room has been created.

Preview status SHALL NOT disable or otherwise gate an otherwise valid room-create submission. A pending, positive, unavailable, or stale preview remains subordinate to the existing server-authoritative create operation, which independently decides whether a room and assignments can be created.

Pre-implementation acceptance-test level: **E2E** for visible pending, resolved, unavailable, retryable verification-failure, correction, duplicate, and stale-response states in the authenticated personal dashboard; supplemented by a **backend integration exception** for authenticated-only enforcement, strict raw-JSON duplicate-field rejection, response-data minimization, and direct-request enumeration boundaries that are not reliably isolated in a browser journey.

#### Scenario: A creator pastes an eligible UUID

- **WHEN** an authenticated creator pastes a complete eligible hiring-manager invitation UUID into “Нанимающие менеджеры” and the input remains stable through the debounce interval
- **THEN** the form first exposes `Проверяем нанимающего менеджера…` and then identifies the corresponding prospective assignment as `Будет добавлен: {displayName}`
- **AND** the raw UUID remains in the draft and no room membership, tracked association, or room is created before the creator submits the form

#### Scenario: A complete but unavailable UUID is corrected

- **WHEN** an authenticated creator enters a complete UUID for an unknown or currently ineligible account
- **THEN** the form displays only `Нанимающий менеджер не найден или недоступен` without a display name or account classification
- **AND** the creator can replace it with an eligible UUID and receives the eligible result without losing the room title, selected tasks, or other target IDs

#### Scenario: Pasted duplicates and partial editing do not create misleading results

- **WHEN** an authenticated creator pastes the same UUID in different case or more than once, then edits or removes one of the occurrences while a lookup is pending
- **THEN** the form has at most one current prospective-target result and one active lookup for the normalized UUID
- **AND** any completion from the obsolete request is ignored and cannot display a removed or superseded manager
- **AND** an incomplete token is not remotely looked up or labelled as unavailable

#### Scenario: Preview temporarily cannot read account data

- **WHEN** an authenticated creator's completed UUID lookup reaches an unexpected preview persistence failure
- **THEN** the form displays only `Не удалось проверить нанимающего менеджера. Повторите попытку.` and does not show a name or unavailable classification
- **AND** retrying or correcting the UUID can resolve the result without losing room title, selected tasks, or other target IDs

#### Scenario: A preview does not gate creation

- **WHEN** an otherwise valid authenticated room draft has a pending, unavailable, or stale preview
- **THEN** the preview itself does not disable or block the create action
- **AND** the established server-side create validation independently accepts or rejects the submitted normalized target list

#### Scenario: A previously eligible target changes before creation

- **WHEN** a creator sees an eligible preview and the target becomes ineligible before the room-create request commits
- **THEN** the preview does not grant access or claim a successful assignment
- **AND** the existing server-authoritative room-create validation rejects the request atomically with its established privacy-safe correction feedback

### Requirement: Invitation UUID preview is authenticated and privacy-safe

The system SHALL provide the preview through an authenticated, read-only server operation for exactly one complete invitation UUID at a time. Its strict JSON request boundary SHALL reject a raw body containing the `invitationId` property more than once, even when duplicate values are equal, rather than selecting a first or last value. The server SHALL derive both the requesting identity and target eligibility exclusively from current server-side account data; client-supplied role, display-name, or eligibility claims SHALL have no authority. A successful eligible result SHALL expose only the normalized invitation UUID needed to correlate the form result and that target's display name. It SHALL NOT expose email address, nickname, password data, authentication credentials, room history, role/eligibility flags, or any other account fields.

An unauthenticated, invalid, deleted, or forged session request SHALL be denied. The current platform has no session TTL or server-side revoke/logout feature, so this capability SHALL NOT claim expiry enforcement; that platform hardening is a separate security follow-up. An unknown UUID, a non-hiring-manager account, an unavailable account, and a target that cannot be assigned SHALL have indistinguishable externally observable unavailable semantics and SHALL reveal no target detail. A duplicate-field or other malformed preview request SHALL be rejected at the request boundary with a generic validation outcome and no lookup/write. An unexpected preview-specific persistence failure SHALL return a generic `503 Service Unavailable` response with both `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; its body and headers SHALL contain no database, exception, query, account, token, or stack-trace detail. Public and guest room-creation flows SHALL NOT render a preview control, invoke the read-only operation, or gain a lookup/assignment field by submitting it directly. The operation SHALL not write room, membership, tracking, profile, or realtime state, and its results SHALL not be treated as a durable authorization cache.

Pre-implementation acceptance-test level: **backend integration exception** for direct authentication, strict duplicate-field rejection, forged-field, public-route, uniform unavailable-response, safe `503` headers/body, and no-write boundaries; **E2E** for authenticated visible name versus generic unavailable/retryable feedback and absence from the public/guest create flow.

#### Scenario: The owner sees only an eligible target's display name

- **WHEN** an authenticated creator resolves a UUID for an eligible account
- **THEN** the response and form expose that account's display name and the UUID correlation only
- **AND** no response or rendered state exposes nickname, email, tokens, room data, or an eligibility/role field

#### Scenario: Direct lookup cannot distinguish unavailable accounts

- **WHEN** an authenticated creator directly requests lookup for an unknown UUID, a UUID of an ordinary account, or a UUID whose target became ineligible
- **THEN** each request has the same unavailable outcome and no target-specific account data
- **AND** no room, membership, tracked association, or profile data is written

#### Scenario: A guest attempts to invoke preview

- **WHEN** an unauthenticated or public/guest caller invokes the preview operation or sends lookup-related fields to a public room-create route
- **THEN** the server denies the preview request and rejects unsupported public assignment input according to the existing public-create contract
- **AND** the public/guest UI continues to expose neither a target field nor preview results

### Requirement: The preview operation has a fixed opaque HTTP contract

The system SHALL expose preview only through authenticated `POST /api/me/hiring-manager-preview` with `Authorization: Bearer <token>` and a JSON body containing exactly `{ "invitationId": "<complete UUID>" }`. The strict parser SHALL reject a raw JSON body that contains `invitationId` more than once, including equal duplicate values, instead of selecting either occurrence. The operation is read-only and retry-safe: it SHALL NOT write a room, membership, assignment, tracking record, profile, session, analytics event, or realtime/SSE event. It SHALL NOT offer a `GET` variant, batch/list/search endpoint, query parameter, or public/guest route.

The body parser SHALL reject absent, duplicate, non-string, blank, malformed, or extra fields as `400 Bad Request` using the established JSON error envelope without target details. It SHALL reject client-supplied requester identity, role, eligibility, or display-name fields rather than accepting or silently trusting them. The server SHALL normalize a syntactically valid invitation UUID with the same canonical UUID rule used by authenticated room creation.

For a current eligible target, the endpoint SHALL return `200 OK` and exactly `{ "normalizedId": "<canonical lowercase UUID>", "displayName": "<stored display name>" }`. For every unknown, non-eligible, opted-out, or otherwise unusable target, it SHALL return the same `404 Not Found` error envelope `{ "error": "Нанимающий менеджер не найден или недоступен" }`; it SHALL include no target payload or reason. Missing, invalid, deleted, or forged sessions SHALL receive the established `401 Unauthorized` error envelope without target detail. There is no hiring-manager-role requirement for the requesting authenticated creator.

Every defined `200`, `400`, `401`, opaque `404`, and preview-specific `503` response SHALL set both `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. An unexpected persistence failure in preview SHALL use `503 Service Unavailable` with a generic body and headers that contain no database, exception, query, target, token, or stack-trace detail. If an inherited deployment limit produces `429 Too Many Requests`, it SHALL be generic and retryable, include `Retry-After` when supplied by that control, and SHALL NOT classify the target. The browser SHALL map only the opaque `404` to “Нанимающий менеджер не найден или недоступен”; invalid, throttled, transport, and server errors are not evidence of unavailability.

Pre-implementation acceptance-test level: **backend integration exception** for the exact endpoint/method, strict request boundary, status/body/header mapping, authentication, opaque target outcomes, and no-write behavior. **E2E** verifies that only the successful minimal response is rendered as an added manager and that generic unavailable feedback remains available for the opaque outcome.

#### Scenario: A direct malformed or forged request reveals no target information

- **WHEN** a caller sends an invalid body, extra identity/role/display-name field, or absent/invalid bearer session to `POST /api/me/hiring-manager-preview`
- **THEN** it receives the contract's `400` or `401` JSON error without a target payload
- **AND** the response has `Cache-Control: no-store`, performs no write, and the supplied fields cannot influence requester identity or eligibility

#### Scenario: All unavailable targets have one response

- **WHEN** an authenticated creator posts the UUID of an unknown account, an ordinary account, or an account that has opted out
- **THEN** each call returns the same `404` status, same generic error body, and same no-store/referrer policy
- **AND** none exposes an account name, nickname, email, role, `isHr`, or reason for the outcome

#### Scenario: Duplicate raw invitation fields are rejected without choosing a target

- **WHEN** an authenticated caller sends a raw JSON preview body containing `invitationId` more than once
- **THEN** the server returns generic `400 Bad Request` without selecting either value or returning target data
- **AND** the response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer` and performs no write

#### Scenario: Preview persistence fails unexpectedly

- **WHEN** an authenticated preview lookup reaches an unexpected persistence failure
- **THEN** the server returns generic `503 Service Unavailable` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`
- **AND** the body and headers expose no database, exception, query, target-account, token, or stack-trace detail
- **AND** the operation performs no write
