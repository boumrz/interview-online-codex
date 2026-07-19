## Requirements

### Requirement: Realtime relay authorization failures are bounded
The room client SHALL make at most one reconnection recovery attempt for a queued event rejected with `403`. If the same queued event receives another `403`, the client SHALL stop the realtime transport, discard queued events, and SHALL NOT schedule more relay requests until a new room connection is initiated.

#### Scenario: An invalid session is rejected repeatedly
- **WHEN** the relay rejects the first queued room event with `403`
- **THEN** the client may reconnect once to obtain a fresh server event token
- **WHEN** the relay rejects that same queued event with `403` again
- **THEN** the client stops the retry loop and does not issue more `/events` requests for that failed session

### Requirement: Interactive room access requires a confirmed realtime session
The room page SHALL not render editable workspace controls until it has received a server `state_sync` for the current browser session. If realtime access cannot be confirmed after bounded recovery, it SHALL show a non-editable access error.

#### Scenario: A direct link is opened without a valid realtime session
- **WHEN** a visitor opens a room link and the server does not confirm their realtime session
- **THEN** the visitor cannot edit or send room events
- **AND** the page explains that access to the room was not confirmed

### Requirement: Anonymous candidate invitations remain supported
The system SHALL allow an anonymous visitor who has a room invitation link and a display name to join as a candidate after the server confirms their realtime session.

#### Scenario: A candidate joins through an invitation link
- **WHEN** an anonymous visitor supplies a display name and receives `state_sync`
- **THEN** the interactive candidate workspace becomes available
- **AND** interviewer-only controls remain unavailable
