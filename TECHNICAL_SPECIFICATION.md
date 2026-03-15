# Technical Specification: interview-online

## 1. Product Goal

Build a platform for technical interviews with real-time collaborative code editing.

Key goals:
- interviewer creates a room and sends a link to candidate;
- both edit code in real time;
- interviewer controls interview steps and can push the next prepared task;
- only room owner can run code;
- room creation is available without registration from landing page;
- registered users have a personal dashboard with room history.

## 2. User Roles

- Guest Owner: creates a room from landing without registration.
- Registered Owner: logs in and creates rooms from dashboard.
- Participant: joins room by invite link.

There is no full RBAC model. Ownership is room-scoped.

## 3. Scope

### 3.1 MVP In Scope
- room creation and join by link;
- real-time collaborative code editor;
- language switching by owner;
- interview steps with preloaded tasks;
- owner-only code execution;
- login/register + dashboard;
- guest room creation from root page.

### 3.2 Out of Scope
- payment/subscription;
- advanced anti-cheat;
- production-grade distributed CRDT cluster;
- video/audio calling;
- granular enterprise access model.

## 4. Functional Requirements

### FR-1 Room Lifecycle
- any user can create room;
- room has owner session token;
- participant joins room by link;
- room metadata includes current language, current step, current code.

### FR-2 Real-time Collaboration
- when one participant edits code, others receive updates;
- participants presence is visible;
- reconnect restores latest room state.

### FR-3 Interview Steps
- room contains a list of prepared tasks;
- owner can move to next task;
- moving to next task replaces code editor content with starter code.

### FR-4 Code Execution
- run action available only to owner;
- run endpoint validates owner token server-side;
- execution result returns stdout, stderr, exit code and timeout flag.

### FR-5 Code Editor
- syntax highlighting for modern languages (MVP: JavaScript, TypeScript, Python, Kotlin);
- owner can switch language for the whole room.

### FR-6 Account Area
- register and login;
- dashboard with created rooms;
- create room with preloaded interview tasks.

### FR-7 Guest Flow
- create room from landing without registration;
- receive invite link and owner token;
- enter room immediately.

## 5. Non-Functional Requirements

### NFR-1 Latency
- editor update propagation target: <300ms in local region under normal load.

### NFR-2 Consistency
- server-authoritative room state;
- last-write-wins for MVP text sync.

### NFR-3 Availability
- reconnect within 30s restores latest state.

### NFR-4 Security
- owner-only execution validated on backend;
- password hashing with BCrypt;
- token-based auth for user session and room owner session;
- execution sandbox timeout and output size limits.

### NFR-5 Observability
- structured logs for room creation, join, step switch, code run.

## 6. Architecture Decisions

- transport: WebSocket for collaborative updates;
- sync model: server-authoritative full-document sync for MVP (CRDT-ready boundary);
- backend: Kotlin + Spring Boot + PostgreSQL;
- frontend: React + TypeScript + RTK + RTK Query + CSS Modules + Rspack;
- runtime helper: in-memory room realtime state with periodic persistence hooks.

WebRTC is deferred after stable WebSocket MVP.

## 7. Data Model (High-level)

- users(id, email, password_hash, created_at)
- rooms(id, title, invite_code, owner_user_id nullable, owner_session_token, language, current_step, code, created_at)
- room_tasks(id, room_id, step_index, title, description, starter_code)

## 8. API Contracts (Core)

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/public/rooms`
- `POST /api/rooms`
- `GET /api/rooms/{inviteCode}`
- `POST /api/rooms/{inviteCode}/run`
- `POST /api/rooms/{inviteCode}/next-step`
- `GET /api/me/rooms`

WebSocket:
- `WS /ws/rooms/{inviteCode}?sessionId=<id>&displayName=<name>&ownerToken=<token optional>`

Message types:
- `join`
- `state_sync`
- `code_update`
- `language_update`
- `next_step`
- `presence_update`

## 9. Acceptance Criteria

- AC-1: guest can create room from landing and enter it.
- AC-2: second user joins by link and sees same code editor content.
- AC-3: code changes from one user are visible to others in real time.
- AC-4: owner can switch language and all participants see change.
- AC-5: owner can switch to next task and code resets to starter template.
- AC-6: non-owner cannot execute code.
- AC-7: owner runs code and receives result.
- AC-8: registered user sees list of own rooms in dashboard.

## 10. Open Risks

- full-document sync can conflict under simultaneous edits (acceptable for MVP);
- local process code execution must remain heavily restricted;
- future scaling requires distributed room state (Redis/pub-sub and CRDT upgrade path).
