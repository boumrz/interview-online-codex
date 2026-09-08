# Полная матрица E2E/API

47 файлов, 47 отдельных команд: основной проход 46 + полный recovery supplement. Родитель ранее выполнял только 3 из 8 recovery-кейсов. PASS после повтора не стирает первый FAIL. Команды, адреса и время: `output/release-audit/browser-results.json`, `browser-retry-results.json`.

| Файл | Первый запуск | Повтор на Docker | Итог / ограничения |
|---|---|---|---|
| frontend/tests/e2e/account/e2e-account-room-binding.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/account/e2e-account-switch-fresh-data.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/account/e2e-auth-navigation.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/account/e2e-candidate-modal-smoke.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/account/e2e-interviewer-role-notes-lock.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/account/e2e-participants-presence.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/auth/e2e-invite-token-negative.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/authoring/e2e-markdown-explainer-smoke.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/authoring/e2e-pdf-export-progress.mjs | 1 | 0 | PASS.  |
| frontend/tests/e2e/authoring/e2e-plaintext-language.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/authoring/e2e-private-notes-slash-export.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/authoring/e2e-task-create-language-default.mjs | 1 | 1 | FAIL. Repeated redirect to /login before language assertion; diagnostics preserved. |
| frontend/tests/e2e/chaos/e2e-chaos-fault-injection.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/chaos/e2e-chaos-harness.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/dashboard/e2e-dashboard-redesign.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/dashboard/e2e-dashboard-smoke.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/hr/e2e-hr-cabinet.mjs | 0 | — | PASS. Native-upstream23/23; supplemental fullDocker 22/23; failed case targeted retry1/1. Unstable, cause unconfirmed; not a clean fullDocker suite. |
| frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs | 0 | — | PASS. Runs only three FIFO child cases; all eight recovery cases now covered by separate supplemental command. |
| frontend/tests/e2e/interview/e2e-briefing-focus-mode.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/interview/e2e-demo-interview-scenario.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/interview/e2e-interviewer-step-publication.mjs | 1 | 0 | PASS.  |
| frontend/tests/e2e/interview/e2e-join-race-sync.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/interview/e2e-multi-participant-activity.mjs | 1 | 1 | FAIL. Native bridge504s plus divergent model; fullDocker1399/1400 durable events. |
| frontend/tests/e2e/interview/e2e-room-language-behavior-api.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/interview/e2e-room-step-smoke.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/interview/e2e-smoke.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/platform/e2e-legacy-domain-notice.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/platform/e2e-local-runtime-chunk-recovery.mjs | 0 | — | PASS. Dev5173/18080 only: test checks development runtime chunks. |
| frontend/tests/e2e/platform/e2e-metrika-hosts.mjs | 1 | 1 | PASS after test teardown correction. Two original failures and failed unroute attempt retained; final network-loading teardown passes. |
| frontend/tests/e2e/realtime/e2e-code-sync-regression.mjs | 1 | 0 | PASS.  |
| frontend/tests/e2e/realtime/e2e-cursor-no-dot.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-five-participant-collaboration.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-hidden-tab-sync.mjs | 0 | — | PASS. Headless pass does not prove actual hidden state; separate native minimization probe UNVERIFIED. |
| frontend/tests/e2e/realtime/e2e-late-published-manager-workspace-event.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-manager-workspace-integrity.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-missing-room-sse-recovery.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-public-step-publication-preserves-edits.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-realtime-authorization-recovery.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-refresh-server-source-sync.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-slow-network-sync.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-sse-reconnect-sync.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-yjs-abc-refresh-join-api.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-yjs-delivery-reliability.mjs | 1 | 0 | PASS.  |
| frontend/tests/e2e/realtime/e2e-yjs-multi-participant-sync.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-yjs-queue-boundaries.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/realtime/e2e-yjs-refresh-stale-snapshot-api.mjs | 0 | — | PASS.  |
| frontend/tests/e2e/interview/e2e-activity-history-recovery.mjs | Не был полностью покрыт родителем | Supplemental 0, 8/8 | PASS. `activity-history-recovery-complete.json/.log`; zero skipped. |

Коды: 0 = PASS, 1 = FAIL. Для Metrika финальная отдельная команда после test-only изменения завершилась 0; см. `metrika-assets-teardown-recheck.log`.

Дополнительные прогоны: HR fullDocker 22/23 (`hr-cabinet-full-docker.log`), целевой повтор 1/1 (`hr-metadata-targeted-retry.log`); visibility probe exit2/UNVERIFIED (`visibility-probe-1788725885913.json`).

Окончательно 47 отдельных команд:45 имеют PASS после указанных повторов/корректировки teardown;2 FAIL остаются. Нестабильные первоначальные результаты не сняты и не представлены как чистый PASS всей серии.
