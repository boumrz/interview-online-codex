## 1. Nginx Routing

- [x] 1.1 Replace wildcard HTTP/HTTPS server blocks with explicit interview and finance domain routing.
- [x] 1.2 Keep interview frontend, API, realtime, websocket, and health routing unchanged for interview domains.
- [x] 1.3 Proxy `domiknote.ru` to a configurable Finance Assistant upstream.

## 2. Deployment Configuration

- [x] 2.1 Add runtime environment variables for interview server names, finance domain, finance cert domain, and finance upstream.
- [x] 2.2 Add a compose override that connects interview web to the shared proxy network.
- [x] 2.3 Update SSL initialization and deployment docs for multi-domain certificates and verification.

## 3. Verification

- [x] 3.1 Validate OpenSpec and render Nginx configs locally.
- [x] 3.2 Validate Docker Compose config and run available frontend/backend checks.
- [ ] 3.3 Run server-side `nginx -t` and external curl checks after certificates are mounted.
