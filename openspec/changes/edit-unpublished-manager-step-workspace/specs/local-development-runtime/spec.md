## ADDED Requirements

### Requirement: Local room deep links and stale chunks recover into the current application shell

The local Rspack development server MUST serve the SPA HTML shell for a direct request to a client-side room URL. If a lazy room-route import fails solely because the browser holds an obsolete development chunk after the server has been restarted or rebuilt, the application MUST reload the current shell once and MUST NOT leave the user on an unrecoverable `ChunkLoadError` screen. A subsequent non-chunk runtime failure MUST remain visible rather than entering a reload loop.

#### Scenario: A room URL is refreshed directly

- **WHEN** a browser opens or refreshes `/room/<invite>` against the local frontend development server
- **THEN** the server returns the SPA shell rather than `Cannot GET`
- **AND** the application can load the room route or perform its normal authentication redirect

#### Scenario: A development chunk becomes stale

- **WHEN** an already open local browser requests a room-route chunk that no longer exists after a frontend development-server restart
- **THEN** the application reloads the current SPA shell once
- **AND** the retried navigation does not remain on a `ChunkLoadError` screen
- **AND** a repeated or non-chunk runtime error is shown normally without repeated reloads
