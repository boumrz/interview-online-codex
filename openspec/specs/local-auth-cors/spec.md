## Requirements

### Requirement: Standard local frontend origins may call authentication APIs
The backend SHALL accept CORS preflight and registration requests from both `http://localhost:5173` and `http://127.0.0.1:5173` for `/api/auth/**`.

#### Scenario: Registration is opened through the loopback hostname
- **WHEN** the frontend at `http://127.0.0.1:5173` preflights `POST /api/auth/register`
- **THEN** the backend returns a successful CORS preflight response
- **AND** includes `Access-Control-Allow-Origin: http://127.0.0.1:5173`

### Requirement: Configured origins extend local defaults
The `app.cors.allowed-origins` configuration SHALL add allowed origins without removing the standard local frontend origins.

#### Scenario: An environment value contains only localhost
- **WHEN** `app.cors.allowed-origins` is configured as `http://localhost:5173`
- **THEN** a preflight from `http://127.0.0.1:5173` is still accepted
