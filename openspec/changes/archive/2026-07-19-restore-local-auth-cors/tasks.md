## 1. Local authentication CORS recovery

- [x] 1.1 Add a red Spring MVC CORS regression with `app.cors.allowed-origins` narrowed to localhost; assert that the `127.0.0.1:5173` registration preflight remains accepted.
- [x] 1.2 Compose configured CORS origins additively with the standard local frontend origins while keeping explicit matching.
- [x] 1.3 Run the backend CORS regression, frontend registration E2E, backend build/tests, frontend typecheck/build, and strict OpenSpec validation.
