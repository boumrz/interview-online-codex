## Context

The completed `rename-hr-to-hiring-manager` change added an optional raw `hiringManagerIds` list to authenticated room creation. It intentionally validates all targets only inside the create transaction, so the current dashboard can only report an invalid target after submit. See [proposal.md](proposal.md) and the new `hiring-manager-input-preview` capability for product behavior.

The fixed stack uses a React/TypeScript RTK Query client and Kotlin/Spring Boot server. Existing account IDs are generated UUIDs, existing public creation must not accept targets, and the server remains authoritative for stored hiring-manager capability and room access.

## Goals / Non-Goals

**Goals:**

- Resolve one completed invitation UUID at a time for an authenticated creator without exposing a general account directory.
- Give the form deterministic pending, eligible, unavailable, and locally incomplete states while preserving rapid input and pasted-list usability.
- Keep preview, creation, account capability changes, and stale browser responses safe under concurrent activity.
- Preserve the all-or-nothing room-creation transaction and existing public/guest behavior.

**Non-Goals:**

- Searching by name, nickname, email, or partial UUID; listing hiring managers; inviting a manager from a public flow; or changing global capability through this feature.
- Creating membership, tracking, a room, an SSE event, or a new persistence model as part of a lookup.
- Replacing create-time eligibility checks with client feedback, adding a room role, or allowing a preview result to reserve an account.

## Decisions

### 1. Server-authoritative, authenticated single-ID preview contract

The backend SHALL expose exactly one personal-dashboard lookup operation:

```http
POST /api/me/hiring-manager-preview
Authorization: Bearer <current-session-token>
Content-Type: application/json

{ "invitationId": "550e8400-e29b-41d4-a716-446655440000" }
```

`POST` is deliberately an RPC-style **read-only** operation here: the UUID stays in a JSON body rather than a URL path or query string, reducing leakage into browser history, referrers, and standard request-URL logs. It is safe to retry because it has no state change, but it is not advertised as a cacheable resource. A `GET` variant, batch endpoint, query parameter, name/nickname/email lookup, and every `/api/public/**` or guest equivalent are explicitly out of scope.

The request DTO is `ResolveHiringManagerPreviewRequest(invitationId: String)` and accepts exactly one non-null string field. Its boundary deserializer/validation MUST reject an absent, non-string, blank, malformed, or unknown field (including client-supplied `userId`, `displayName`, `isHr`, `role`, or requester identity) as a generic `400`; unknown fields must not be silently ignored. The server canonicalizes a valid UUID exactly as the existing creation flow does: trim, parse, require canonical hyphenated UUID form case-insensitively, then return lowercase `UUID.toString()`.

The response DTO is deliberately independent from `UserDto` and room DTOs:

```json
{ "normalizedId": "550e8400-e29b-41d4-a716-446655440000", "displayName": "Анна Иванова" }
```

No other key is permitted in a successful response. In particular, it MUST NOT serialize nickname, email, global role, `isHr`, session/token data, room data, or an internal eligibility reason.

| Situation | HTTP result | Body / headers |
| --- | --- | --- |
| Current session; canonical target exists and currently has hiring-manager capability | `200 OK` | Only `HiringManagerPreviewResponse`; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and the established JSON content type. |
| Canonical UUID is unknown, target is not a hiring manager, has opted out, or cannot be assigned | `404 Not Found` | Existing error envelope only: `{ "error": "Нанимающий менеджер не найден или недоступен" }`; no target payload or classification; same `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. |
| Missing, invalid, deleted, or forged bearer session | `401 Unauthorized` | Existing generic authentication error envelope, with no target detail and `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. There is no `403` role gate: any authenticated account that can use authenticated room creation may check a supplied invitation UUID. |
| Malformed body, duplicate field, missing/extra field, or non-canonical UUID | `400 Bad Request` | Existing error envelope with a generic input message (for example, `{ "error": "Некорректный идентификатор нанимающего менеджера" }`); no target detail and `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. |
| Unexpected preview persistence failure | `503 Service Unavailable` | Generic retryable error only, with no database, exception, query, account, token, or stack-trace detail; `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. |
| Deployment edge/app-level overload control | `429 Too Many Requests` if supplied by the existing deployment control | Generic retryable error only, `Retry-After` when that control supplies it, and no target detail. The client presents retryable verification feedback, never the unavailable result. |

The authenticated route is owned by a new `HiringManagerPreviewController`, not `RoomController` or a public controller. It extracts the bearer token through existing `AuthService.requireUserByToken`; it never accepts requester identity from the body. `HiringManagerPreviewService` owns canonicalization and the `@Transactional(readOnly = true)` lookup against `UserRepository`; it maps a missing or currently `isHr == false` target to the same `404` helper. Its strict parser rejects a duplicate raw `invitationId` member rather than selecting either value. It does not call `RoomService`, `RoomHrTrackingService`, collaboration/SSE services, or repositories that write memberships, assignments, profiles, rooms, or telemetry. The controller/service must attach the no-store/referrer headers to every defined `200`, `400`, `401`, `404`, and preview-specific `503` response, including exceptions translated through the established error envelope; persistence failures use a generic endpoint-local `503` rather than the application's operational database message.

The operation needs no room authorization because a room does not yet exist. Its privacy boundary is instead: authenticated current-session access, UUID-only input, minimal positive data, indistinguishable unavailable data, no public surface, no caching, and no raw invitation UUID/display-name application logs, analytics, or traces. The route intentionally adds no process-local rate-limit state for MVP: the only input is a high-entropy full UUID, the dashboard coalesces and debounces requests, and the operation inherits deployment/API-edge controls where configured. If such control returns `429`, it must remain target-opaque as above. The repository does not configure an ingress limiter, so production rollout requires an operator to confirm a proportionate authenticated API limit; that is an operational deployment prerequisite, not a new in-process directory/rate-limit subsystem in this change. The existing platform also has no session TTL or server-side logout/revoke model: this endpoint rejects missing, invalid, deleted, or forged sessions through the same current auth path, while session lifecycle is recorded as a separate security follow-up rather than promised here as expiry support.

This gives the form the one product datum it needs while preserving the existing UUID invitation model and resisting an account-directory endpoint. It also keeps capability changes between preview and create safe because the transaction is still authoritative.

Alternatives considered:

- **Put target name and eligibility into `POST /api/rooms` errors:** rejected because feedback would still arrive only after submit and would make atomic create errors more data-bearing.
- **Return account details for all syntactically valid IDs:** rejected because it enables account enumeration and exceeds the form's need.
- **Trust the browser's eligible result during room creation:** rejected because it permits stale capability and forged data to assign access.

### 2. Debounced, cancellable request generations in the form

The form will tokenize the raw textarea exactly as the create flow does, normalize UUIDs for comparison, and maintain one result per unique complete UUID. After **300 ms** of stability, it starts a lookup for an otherwise unseen/changed complete UUID. It shows a checking state during the request. Incomplete or malformed fragments stay local and do not start a network request.

Each request is associated with the current normalized UUID, draft generation, and authenticated identity. A later edit, deduplication, logout/account switch, navigation, or unmount cancels the request where transport permits and always invalidates its generation. A completion may update the screen only if its generation is still current. The frontend must avoid a durable cross-account cache; at most it can retain an in-form result for the unchanged current draft.

This meets the "immediately visible" product intent without one request per keystroke and prevents delayed responses from restoring removed names. A non-debounced lookup was rejected for unnecessary backend load and flickering. Global cached lookup data was rejected because capability can change and must not cross user sessions.

### 3. Preview is advisory; create remains atomic and independently revalidated

The room-create request remains the existing optional normalized `hiringManagerIds` contract. It neither includes display names nor reports client lookup state. The create transaction locks/rechecks all targets using the established all-or-nothing implementation. A preview success is not a reservation and cannot alter submit authorization. A create request may proceed under the existing form semantics while a preview is pending; any outcome is governed by the create endpoint rather than the pending request.

This avoids a new client/server state machine and guarantees that availability changes, target deletion, or capability opt-out cannot lead to a partial room. Disabling submit until all previews finish was rejected because it would be an unrequested behavior change and would still not replace the server check.

### 4. Privacy and transport safeguards

Every defined endpoint response (`200`, `400`, `401`, opaque `404`, and preview-specific `503`) SHALL have both `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. A preview persistence failure is deliberately translated at the endpoint to a generic retryable `503`, rather than exposing the global database diagnostic. The client must not store positive results in local storage, analytics payloads, error telemetry, or a shared RTK Query cache that survives identity/context changes. The typed API seam uses an abortable, non-fixed-key RTK Query mutation (or equivalent raw abortable request), rather than a cacheable query endpoint. UI logging must not emit raw invitation UUIDs or display names. Browser-visible messages use the generic unavailable phrase only for the opaque `404`; malformed, throttled, transport, and server failures use a generic retryable/format state and never render a display name.

The implementation shall use the existing authenticated API client/header path; public endpoints and guest forms do not gain a lookup type, field, or API call. Because lookup has no write, it emits no SSE event and needs no reconnect synchronization; after reconnect or a fresh create submission, server-side revalidation is still authoritative.

### 5. No persistence migration; server-first compatible rollout

The lookup reads existing user data only. No schema or data migration, room model change, Yjs state change, or SSE protocol change is required. Deploy the backend endpoint first, then the frontend; previous clients remain compatible because room creation is unchanged. If frontend rollout is rolled back, the unused authenticated endpoint is harmless. If backend rollout is rolled back, the frontend must fail closed to the existing generic retryable form feedback and must not portray a manager as added.

## Risks / Trade-offs

- **A manager opts out after a positive preview** → Creation performs current server-side revalidation under its existing transaction; UI treats preview as informational.
- **Rapid typing/pasting creates response races or excessive traffic** → 300 ms debounce, unique-ID coalescing, abort/generation guards, and integration tests for no stale state.
- **Lookup becomes an account-discovery source** → authentication, UUID-only input, successful response minimalism, uniform unavailable outcomes, no public route, no shared cache, and security review.
- **A delayed lookup overwrites a create/navigation/account-switch outcome** → bind updates to draft and identity generation; cancel/ignore obsolete completions.
- **Backend response compatibility is inconsistent with current error handling** → Architect confirms the route/error envelope; integration tests assert generic behavior rather than database exception text.
- **Bulk pasted UUID lists increase lookup volume** → de-duplicate current tokens and one active lookup per normalized UUID. This change does not introduce a separate directory/rate-limit subsystem; production rollout needs an operator-confirmed authenticated ingress limit, and any `429` response is generic and retryable.
- **The platform has long-lived bearer sessions** → session TTL, revoke, and server-side logout are pre-existing authentication work and must be tracked separately; this endpoint does not claim an unavailable session-expiry feature.

## Migration Plan

1. Keep `rename-hr-to-hiring-manager` as the predecessor source for authenticated creation-time assignment until its accepted delta is synced or archived; do not archive this dependent change ahead of it.
2. Add the new endpoint and server-side integration tests without modifying existing create behavior.
3. Release the server contract with no persistence migration and verify authenticated/public authorization boundaries.
4. Release the dashboard control and E2E tests; monitor only aggregate request/error counts without invitation IDs or display names.
5. On rollback, remove or disable the frontend invocation first. The existing create endpoint continues to validate targets atomically, and no data cleanup is required.

## Resolved Questions

- **P1 — API shape:** Resolved as read-only `POST /api/me/hiring-manager-preview` with a strict one-field JSON request, `200` minimal positive DTO, opaque `404` unavailable outcome, and `no-store` protection. The POST body keeps invitation UUIDs out of request URLs; create-time validation remains unchanged.
