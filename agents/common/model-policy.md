# Model and Context Policy

Use the user's selected model and the tool's supported runtime settings. Agent role names do not impose Opus, Sonnet, Haiku, or provider-specific tiers. Do not change configured model fields as part of a documentation update.

Control cost through bounded work:

- Prefer direct execution over a mandatory chain of agents.
- Load only the relevant feature, shared rules, and implementation context.
- Delegate a concrete independent question or file slice; avoid duplicated repository exploration.
- Reuse useful specialist findings instead of rereading and rechecking everything.
- Require independent review for the risks identified in [the specification standard](../../specs/README.md); do not make formatting/checklist roles mandatory.
- Produce compact outcomes and link detailed evidence.

If a selected runtime cannot complete a task, identify the missing capability or information. Model selection is a runtime/user decision, not a fixed project tier table. Evaluate cost over delivery through acceptance, including clarification and rework.
