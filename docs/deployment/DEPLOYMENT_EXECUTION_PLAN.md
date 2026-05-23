# Interview Online — Deployment Planning Pack

This document completes the planning-only deployment backlog:
- `BOU-27` topology
- `BOU-26` secrets matrix
- `BOU-28` CI/CD design
- `BOU-29` provisioning/runtime layout
- `BOU-30` backend readiness
- `BOU-31` frontend readiness
- `BOU-33` go-live runbook and rollback

No production rollout actions are executed in this document.

---

## 1) Target Infrastructure and Rollout Topology (`BOU-27`)

## Recommended topology (staging + production)
- `frontend` (static assets + edge cache) on managed static hosting/CDN.
- `backend` on container runtime (single service image).
- `postgres` as managed DB (preferred) with automated backups.
- reverse proxy/TLS at edge (CDN + WAF or managed LB + cert manager).

## Environment layout
- `staging`: full copy of production topology, reduced size.
- `production`: isolated network segments and stricter security policies.

## Rollout order
1. provision network, DNS, TLS, DB.
2. deploy backend + DB connectivity and migrations.
3. deploy frontend with production API URLs.
4. run smoke tests and promote traffic.

## Owner actions required
- approve final hosting vendor(s).
- approve domain and TLS ownership model.

---

## 2) Secrets Inventory and Ownership Matrix (`BOU-26`)

## Runtime config/secrets
- `DB_URL` — owner: DevOps/Backend lead — required.
- `DB_USER` — owner: DevOps/Backend lead — required.
- `DB_PASSWORD` — owner: DevOps/Backend lead — required.
- `CORS_ORIGINS` — owner: Backend lead — required.
- `AGENT_LINEAR_SYNC_ENABLED` — owner: Product/Backend lead — optional.
- `LINEAR_API_KEY` — owner: Product owner — optional when sync enabled.
- `AGENT_LANGFUSE_ENABLED` — owner: Observability owner — optional.
- `AGENT_LANGFUSE_URL` — owner: Observability owner — optional.
- `AGENT_LANGFUSE_API_KEY` — owner: Observability owner — optional.
- `FEATURE_AGENT_OPS` (frontend) — owner: Product/Frontend lead — optional.
- `FRONTEND_API_BASE_URL` (frontend) — owner: Frontend lead — required.

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
- backend: redeploy previous image tag.
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
3. create compute for backend.
4. configure load balancer/reverse proxy with TLS.
5. configure firewall rules:
   - public: `443` only.
   - backend internal access from LB only.
   - DB access from backend only.
6. configure monitoring/log shipping.
7. configure alerting for API latency/error rate, DB saturation.

## Sizing baseline (starting point)
- backend: 2 vCPU / 4 GB RAM.
- postgres: managed small/medium tier with storage autoscaling.
- scale based on p95 latency and queue depth.

## Owner actions required
- approve cloud region and data residency constraints.
- approve backup retention and RPO/RTO targets.

---

## 5) Backend Production Readiness Checklist (`BOU-30`)

- [ ] all localhost URLs replaced with env-driven configuration.
- [ ] `CORS_ORIGINS` includes only approved domains.
- [ ] migration/startup order documented and validated in staging.
- [ ] auth/session hardening reviewed (expiry, revocation strategy).
- [ ] health/readiness endpoints monitored.
- [ ] logs redact sensitive fields.

## Owner actions required
- provide final production frontend domains.
- approve auth token lifetime policy.

---

## 6) Frontend Production Readiness Checklist (`BOU-31`)

- [ ] API URLs are env-driven and per-environment.
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

## 7) Go-Live Runbook, Smoke, and Rollback (`BOU-33`)

## Go-live sequence
1. freeze release branch/tag.
2. verify staging green and artifacts signed.
3. deploy backend.
4. deploy frontend.
5. execute smoke tests.
6. monitor for stabilization window.

## Smoke checklist (post-deploy)
- [ ] auth login/register works.
- [ ] dashboard rooms/tasks load.
- [ ] room creation works.
- [ ] invite join works.
- [ ] realtime sync works between 2 clients.
- [ ] task bank create/edit/delete flows work.

## Rollback triggers
- p95 latency breach > agreed threshold for 10+ minutes.
- error rate above threshold for 5+ minutes.
- critical user flow broken (auth/room/realtime).

## Rollback steps
1. roll back frontend artifact.
2. roll back backend image tag.
3. disable new traffic if incident persists.
4. publish incident summary and next mitigation plan.

## Owner actions required
- confirm release window and on-call rotation.
- confirm incident communication channel and rollback authority.
