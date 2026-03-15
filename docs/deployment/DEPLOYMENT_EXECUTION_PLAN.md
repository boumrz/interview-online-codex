# Interview Online — Deployment Planning Pack

This document completes the planning-only deployment backlog:
- `BOU-27` topology
- `BOU-26` secrets matrix
- `BOU-28` CI/CD design
- `BOU-29` provisioning/runtime layout
- `BOU-30` backend readiness
- `BOU-31` frontend readiness
- `BOU-32` isolated runner checklist
- `BOU-33` go-live runbook and rollback

No production rollout actions are executed in this document.

---

## 1) Target Infrastructure and Rollout Topology (`BOU-27`)

## Recommended topology (staging + production)
- `frontend` (static assets + edge cache) on managed static hosting/CDN.
- `backend` on container runtime (single service image).
- `runner` as separate isolated container service (no public ingress).
- `postgres` as managed DB (preferred) with automated backups.
- reverse proxy/TLS at edge (CDN + WAF or managed LB + cert manager).

## Environment layout
- `staging`: full copy of production topology, reduced size.
- `production`: isolated network segments and stricter security policies.

## Rollout order
1. provision network, DNS, TLS, DB.
2. deploy backend + DB connectivity and migrations.
3. deploy runner and connect backend to runner URL.
4. deploy frontend with production API/WS URLs.
5. run smoke tests and promote traffic.

## Owner actions required
- approve final hosting vendor(s).
- approve domain and TLS ownership model.
- confirm `EXECUTION_MODE=isolated` as production baseline.

---

## 2) Secrets Inventory and Ownership Matrix (`BOU-26`)

## Runtime config/secrets
- `DB_URL` — owner: DevOps/Backend lead — required.
- `DB_USER` — owner: DevOps/Backend lead — required.
- `DB_PASSWORD` — owner: DevOps/Backend lead — required.
- `CORS_ORIGINS` — owner: Backend lead — required.
- `AGENT_LINEAR_SYNC_ENABLED` — owner: Product/Backend lead — optional.
- `LINEAR_API_KEY` — owner: Product owner — optional when sync enabled.
- `EXECUTION_MODE` — owner: Backend lead — required.
- `EXECUTION_ISOLATED_URL` — owner: Backend/DevOps — required in isolated mode.
- `EXECUTION_FALLBACK_TO_LOCAL` — owner: Security lead — required.
- `EXECUTION_KILL_SWITCH` — owner: Security/On-call lead — required.
- `AGENT_LANGFUSE_ENABLED` — owner: Observability owner — optional.
- `AGENT_LANGFUSE_URL` — owner: Observability owner — optional.
- `AGENT_LANGFUSE_API_KEY` — owner: Observability owner — optional.
- `FEATURE_AGENT_OPS` (frontend) — owner: Product/Frontend lead — optional.
- `FRONTEND_API_BASE_URL` (frontend) — owner: Frontend lead — required.
- `FRONTEND_WS_BASE_URL` (frontend) — owner: Frontend lead — required.

## Storage policy
- never commit secrets to repository.
- use environment-level secret stores only (CI/CD secret manager + runtime secret manager).
- use separate secret values per environment (`staging`, `production`).
- rotate critical secrets (`DB_PASSWORD`, API keys) quarterly or after incidents.

## Owner actions required
- provide production secret values and rotation contacts.
- confirm which optional integrations are enabled at go-live.

---

## 3) CI/CD Workflow Design (`BOU-28`)

## Branching and release model
- default branch: `main`.
- release tags: `vX.Y.Z`.
- promotion: `main -> staging` (auto), `staging -> production` (manual approval gate).

## Pipeline stages
1. **lint/type/test**:
   - frontend: `npm run typecheck`, `npm run build`, e2e smoke.
   - backend: `mvn test`.
2. **build artifacts**:
   - backend container image.
   - runner container image (if changed).
   - frontend static bundle.
3. **security checks**:
   - dependency audit/SCA.
   - container vulnerability scan.
4. **deploy staging**:
   - apply config/secrets.
   - run smoke tests.
5. **manual approval gate**.
6. **deploy production**.
7. **post-deploy smoke + rollback validation window**.

## Rollback strategy
- backend/runner: redeploy previous image tag.
- frontend: revert to previous static artifact.
- DB: rollback only through approved migration strategy (forward-fix preferred).

## Owner actions required
- confirm CI provider and container registry.
- confirm who can approve production gate.

---

## 4) Server Provisioning and Runtime Layout (`BOU-29`)

## Provisioning playbook
1. create VPC/network and separate subnets for public/private services.
2. create managed Postgres instance with backup retention.
3. create compute for backend and runner.
4. configure load balancer/reverse proxy with TLS.
5. configure firewall rules:
   - public: `443` only.
   - backend internal access from LB only.
   - runner internal access from backend only.
   - DB access from backend/runner only.
6. configure monitoring/log shipping.
7. configure alerting for API latency/error rate, runner failures, DB saturation.

## Sizing baseline (starting point)
- backend: 2 vCPU / 4 GB RAM.
- runner: 2 vCPU / 4 GB RAM isolated.
- postgres: managed small/medium tier with storage autoscaling.
- scale based on p95 latency and queue depth.

## Owner actions required
- approve cloud region and data residency constraints.
- approve backup retention and RPO/RTO targets.

---

## 5) Backend Production Readiness Checklist (`BOU-30`)

- [ ] all localhost URLs replaced with env-driven configuration.
- [ ] `CORS_ORIGINS` includes only approved domains.
- [ ] `EXECUTION_MODE=isolated` in production.
- [ ] `EXECUTION_FALLBACK_TO_LOCAL=false` unless explicitly approved.
- [ ] migration/startup order documented and validated in staging.
- [ ] auth/session hardening reviewed (expiry, revocation strategy).
- [ ] health/readiness endpoints monitored.
- [ ] logs redact sensitive fields.

## Owner actions required
- provide final production frontend domains.
- approve auth token lifetime policy.

---

## 6) Frontend Production Readiness Checklist (`BOU-31`)

- [ ] API and WebSocket URLs are env-driven and per-environment.
- [ ] no hardcoded `localhost` in production bundle.
- [ ] build pipeline injects environment variables at build time.
- [ ] cache policy defined:
  - immutable hashed assets.
  - short TTL for HTML entrypoint.
- [ ] 404/5xx fallback pages configured.
- [ ] room create/join/auth smoke flows validated against production-like backend.

## Owner actions required
- provide production frontend domain.
- confirm CDN/edge provider and cache invalidation policy.

---

## 7) Isolated Runner Deployment and Policy Checklist (`BOU-32`)

- [ ] runner deployed as isolated service (no public ingress).
- [ ] backend configured with `EXECUTION_ISOLATED_URL`.
- [ ] strict runtime constraints configured:
  - CPU/memory/time limits.
  - network egress policy.
  - filesystem restrictions.
- [ ] execution payload size and output limits enforced.
- [ ] abuse detection thresholds documented.
- [ ] emergency disable path documented (`EXECUTION_KILL_SWITCH`).

## Owner actions required
- approve isolation and sandboxing policy.
- approve whether fallback to local execution is ever allowed.

---

## 8) Go-Live Runbook, Smoke, and Rollback (`BOU-33`)

## Go-live sequence
1. freeze release branch/tag.
2. verify staging green and artifacts signed.
3. deploy backend.
4. deploy runner.
5. deploy frontend.
6. execute smoke tests.
7. monitor for stabilization window.

## Smoke checklist (post-deploy)
- [ ] auth login/register works.
- [ ] dashboard rooms/tasks load.
- [ ] room creation works.
- [ ] invite join works.
- [ ] realtime sync works between 2 clients.
- [ ] owner-only code run works.
- [ ] task bank create/edit/delete flows work.

## Rollback triggers
- p95 latency breach > agreed threshold for 10+ minutes.
- error rate above threshold for 5+ minutes.
- critical user flow broken (auth/room/realtime/run).

## Rollback steps
1. roll back frontend artifact.
2. roll back backend image tag.
3. roll back runner image tag (if needed).
4. disable new traffic if incident persists.
5. publish incident summary and next mitigation plan.

## Owner actions required
- confirm release window and on-call rotation.
- confirm incident communication channel and rollback authority.
