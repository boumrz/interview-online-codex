# Collaboration Scenarios

Depth and completion criteria are defined in [the specification standard](../../specs/README.md). These are use cases for specialists, not a required sequence.

| Need | Useful role | Concrete result |
|---|---|---|
| Ambiguous or conflicting product behavior | Specification or Product Owner | Updated feature contract with observable acceptance criteria |
| Nontrivial contract, storage, or cross-module decision | Architect | Bounded decision and necessary implementation contracts |
| Complex interaction or unresolved screen states | Designer | Specific flow and applicable state behavior |
| Work spans independently deliverable slices | Team Lead | Small tasks with ownership and dependencies |
| Task/spec still has doubtful completeness | Prompt/Task Auditor | Ready verdict or precise missing decisions |
| Independent engineering assessment | Solution Reviewer | Defects and contract risks with concrete fixes |
| Significant auth, permissions, invitations, private data, realtime authority, migrations, or execution isolation | Security & Reliability | Independent security/reliability verdict before acceptance |
| Unresolved verification or release risk | QA or Test Reviewer | Targeted checks or coverage gaps |
| Complex UX needs independent scrutiny | UX Critic | User-facing friction and missing states |
| Existing analysis needs a readable deliverable | Analytics | Formatted artifact with sources and missing inputs |

A small fix can be completed by one implementer. A normal feature needs a distinct completeness pass before coding; its author can perform that pass. High-risk work needs independent security/reliability review. Select additional roles only when their question justifies the extra context and cost.

Test-first authoring, implementation, and targeted verification may be one assignment. Do not create separate planning, test, audit, review, or handoff tasks for each mechanical step. Give any reviewer the relevant diff, contract, and evidence rather than replaying the full conversation.
