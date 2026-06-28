## ADDED Requirements

### Requirement: Shared production proxy separates service domains

The production Nginx entrypoint SHALL route each public domain to the correct service and SHALL NOT use a wildcard vhost that serves the interview application for unrelated domains.

#### Scenario: Finance domain routes to Finance Assistant

- **WHEN** a client opens `https://domiknote.ru/`
- **THEN** TLS uses a certificate valid for `domiknote.ru`
- **AND** the request is proxied to the Finance Assistant web container
- **AND** the interview frontend is not served

#### Scenario: Interview domains route to interview-online

- **WHEN** a client opens `https://interview.vtools.tech/` or `https://interview.domiknote.ru/`
- **THEN** TLS uses a certificate valid for the requested interview domain
- **AND** the request is served by the interview frontend and backend routing

#### Scenario: Unknown hostnames fail closed

- **WHEN** a client opens the shared proxy with a hostname that is not configured
- **THEN** the proxy does not serve the interview application as a wildcard fallback

### Requirement: ACME challenge path supports both services

The production Nginx entrypoint SHALL serve `/.well-known/acme-challenge/` from the certbot webroot for all configured public HTTP domains.

#### Scenario: Certbot validates finance domain

- **WHEN** certbot writes a challenge file for `domiknote.ru` into the configured webroot
- **THEN** `http://domiknote.ru/.well-known/acme-challenge/<token>` returns that file

#### Scenario: Certbot validates interview domains

- **WHEN** certbot writes a challenge file for an interview domain into the configured webroot
- **THEN** `http://interview.vtools.tech/.well-known/acme-challenge/<token>` or `http://interview.domiknote.ru/.well-known/acme-challenge/<token>` returns that file

### Requirement: Shared Docker network is available for cross-service routing

The interview web container SHALL be able to resolve and reach the Finance Assistant web container when finance routing is enabled.

#### Scenario: Proxy network connects both web containers

- **WHEN** the interview stack is deployed with shared finance routing enabled
- **THEN** the interview web container joins the shared proxy Docker network
- **AND** it can proxy `domiknote.ru` requests to the configured Finance Assistant upstream
