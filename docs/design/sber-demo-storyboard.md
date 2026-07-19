# Storyboard: Sber executive demo

Status: designed, UX review required.
Audience: Sber senior stakeholders.
Format: prerecorded product demo, 3-4 minutes.
Scope: preparation, running, and evaluating a technical interview.

## Demo Principles

- Treat Pulse and Sber Jazz as context around the interview, not as working integrations.
- Show interview-online as the focused workspace used after an interview is confirmed and while the Jazz call is running.
- Keep the path from room creation to editing short: create room, copy/open invite, start work.
- Make the room owner visually obvious through an owner badge, owner-only control panel, and disabled/hidden controls for the candidate.
- Keep step controls and execution/output controls separate from the shared editor.
- Do not promise live code execution. The output surface may be shown, but the demo must not click Run or narrate execution as working.

## Global Do-Not-Show List

- Real Pulse, Sber Jazz, or internal Sber screens unless explicitly approved for the recording.
- Real candidate names, phone numbers, emails, interview feedback, room tokens, auth tokens, production URLs, or internal IDs.
- Registration as a required step for room creation or candidate joining.
- Backend internals, logs, SSE/Yjs details, database views, API payloads, stack diagrams, or admin panels.
- Clicking a code execution button, showing successful tests as if they were produced live, or claiming language/runtime support beyond the prepared narrative.
- Broken reconnects, reloads during task updates, duplicate controls, or confusing owner/candidate role changes.
- Final hiring decisions or automated scoring that imply the tool replaces interviewer judgment.

## Storyboard

| Scene | Time | What is on screen | Meaning to communicate | Must not show |
| --- | ---: | --- | --- | --- |
| 1. Sber hiring context | 0:00-0:12 | A neutral title frame, not a fake product integration screen: "Confirmed interview -> Jazz call -> interview-online room". Optional small labels: "Pulse context" and "Jazz call context". | The product fits into Sber's hiring flow: Pulse can become the place where the room link appears after interview confirmation, and Jazz remains the call surface. | Do not show real Pulse or Jazz UI, Sber-internal data, or wording that says the integrations already work. |
| 2. Create room without registration | 0:12-0:35 | interview-online landing page. Primary action "Create interview room". Click creates a room and lands directly in the owner room view. Invite link is visible or copied from the room header. | Starting a technical interview workspace is low-friction and does not require setup before the conversation. | Do not show sign-up, plan selection, long setup forms, workspace creation, or technical configuration. |
| 3. Prepare the interview | 0:35-1:15 | Owner room view. Header shows "Owner" badge and invite link. Left panel shows steps: Briefing, Coding, Review. Center shows task briefing and editor. Right owner panel shows language selector, task controls, and private interviewer notes. | The interviewer can prepare the structure, task text, language, and notes inside the room before or during the Jazz call. | Do not show raw markdown syntax as the main view, room IDs, backend fields, or controls mixed into the shared editor area. |
| 4. Candidate joins by invite link | 1:15-1:45 | Candidate opens the invite link in a second browser window or split-screen view. Candidate sees "Participant" badge, current step, task, and editor. Owner-only controls are absent or disabled. Owner view shows participant presence. | Candidate access is link-based and focused. The owner and participant roles are visually and functionally different. | Do not show login gates, email-required flows, candidate access to notes/language controls, or hidden invite tokens in the URL bar. |
| 5. Conduct with live step switching | 1:45-2:20 | Owner selects "Coding" in the step panel. Candidate screen updates the current step banner/task area without a full reload. A small live-update indicator or toast may confirm the step changed. | The interviewer controls interview progression, and everyone stays synchronized during the call. | Do not show page reloads, blank screens, duplicated step state, or candidate ability to switch the room step. |
| 6. Collaborative coding and new task | 2:20-2:55 | Candidate types in the editor. Owner sees shared code/presence and writes a private note. Owner sends or selects the next task. Candidate receives the new task in the task panel without reload. | The room supports live collaboration and lets the interviewer adjust the task while the interview continues. | Do not show conflict resolution internals, editor sync jargon, network logs, or task changes that erase candidate work. |
| 7. Execution/output surface, not live execution | 2:55-3:15 | Output/status panel is visible below or beside the editor: status "Not run in this demo" or "Waiting for execution". If sample output is needed, label it "Example output". | Stakeholders see where execution status and output belong in the workflow, while the recording avoids promising live execution. | Do not click Run, show live compiler output, show green tests as live proof, or say "the platform executes code now" unless that is confirmed for the demo build. |
| 8. Review and evaluation | 3:15-3:40 | Owner switches to Review. Candidate remains in shared room but cannot see private notes. Owner fills short evaluation notes: strengths, concerns, recommendation. | The interview produces structured evidence for follow-up, not just a call transcript. | Do not show sensitive feedback to the candidate, automated hiring decisions, or excessive scoring complexity. |
| 9. Manage rooms from dashboard | 3:40-3:55 | Registered interviewer dashboard. Room list shows the completed room with date, candidate placeholder, status, and actions: open room, open notes, duplicate template. Empty-state copy is not shown in the main recording unless needed. | Registered users can return to rooms, continue preparation, and manage interview history after the live session. | Do not imply candidates need accounts, do not show real people, and do not show dashboard data that cannot be explained in one sentence. |

Target runtime: 3:35-3:55. If the cut must be closer to 3:00, merge scenes 8 and 9 and show the dashboard only as a final 5-second closing frame.

## Screen Specs For Recording

### Landing

- Primary visual focus: one clear "Create interview room" action.
- Secondary action: join by link can exist but must not compete with creation.
- Recording state: success path only.
- Required states for product spec: loading disables create action; error shows retry; empty/default explains no registration is needed.

### Room Owner View

- Header: room title, invite/copy link action, "Owner" badge, participant presence.
- Step panel: separate left-side or top-side control surface with current step highlighted.
- Shared area: task briefing and editor.
- Owner panel: language selector, task update controls, execution/output panel access, and private notes.
- Owner-only controls must be grouped together and visually separated from the shared editor.

### Candidate View

- Header: "Participant" badge and current room title.
- Shared area: task briefing, current step, and editor.
- Hidden or disabled: step switching, language selector, owner notes, room management, and any execution control if execution is owner-only.
- Candidate should receive step and task changes without a full-page reload.

### Dashboard

- Room list item: room title, date/time, status, owner role, candidate placeholder, and primary action.
- Empty state: "No interview rooms yet" plus create-room action.
- Error state: short failure message and retry.
- Loading state: list skeletons, not a blank page.

## Interaction Rules

1. Create room from landing -> route directly to room as owner -> show invite link immediately.
2. Open invite link -> join as participant -> show current step and task -> hide owner-only controls.
3. Owner changes step -> room state updates -> participant receives new step without reload.
4. Owner selects editor language -> editor mode changes for the room -> participant can see the selected language but cannot change it.
5. Owner sends a new task -> task panel updates live -> existing code remains visible.
6. Execution/output panel remains visible as a status surface -> demo does not trigger execution.
7. Owner completes review -> evaluation notes remain owner-only -> room appears in dashboard history.

## State Matrix

| Screen | Empty | Loading | Error | Success | Reconnecting |
| --- | --- | --- | --- | --- | --- |
| Landing | Default marketing-light state with create action and no required account. | Create button disabled with short spinner label. | "Could not create room" with retry. | Room is created and owner room opens. | Not applicable. |
| Owner room | New room with empty notes and initial step selected. | Room shell with skeleton panels. | Room unavailable or create/join failed; show retry/back to landing. | Owner controls, step panel, shared editor, notes, and invite visible. | Banner: "Reconnecting"; editor remains visible; owner actions disabled until restored. |
| Candidate room | Joined room with current task empty or waiting for owner. | Room shell with current role pending. | Invite invalid, room closed, or join failed; show clear message. | Participant badge, current step, task, and editor visible. | Banner: "Reconnecting"; typing state preserved locally where possible; no reload. |
| Dashboard | No rooms yet with create-room action. | Skeleton room rows. | Could not load rooms with retry. | Room list with statuses and actions. | If realtime status is present, show stale-state badge instead of clearing the list. |
| Output panel | "No execution yet" or "Not run in this demo". | Pending status with spinner if execution is triggered outside this recording. | Failure state with concise output area and retry only if supported. | Status and output text visible. | Existing output remains visible; new execution actions disabled. |

## Recording Notes

- Use synthetic names: "Interviewer", "Candidate", "Backend task", "Queue processor".
- Keep browser chrome cropped enough to avoid tokens, but leave enough context to understand the owner/candidate split.
- Use a prepared code snippet that looks realistic but does not require explaining algorithms in depth.
- Voiceover should describe business flow and interviewer control, not implementation details.
- Close with "integration points" language for Pulse and Jazz, not "integrated today" language.

