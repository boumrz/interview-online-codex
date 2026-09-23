### P4.2 Интервью процесса с обязательной основой

Цель: интервью, созданное из процесса, сохраняет обязательную основу и разрешает extras отдельно.

Реализовано:

- resolve/pin programme version при создании;
- mandatory scaffold/context protected через все entry points;
- extras остаются редактируемыми;
- stale programme conflict.

Проверка: backend PostgreSQL integration для конфликта версии, защиты REST/realtime правок и сохранения candidate solution; frontend isolated E2E для повторного просмотра новой версии, создания интервью и read-only основы в комнате; frontend typecheck.

Acceptance:

- нельзя обойти обязательную основу через legacy PATCH/DELETE/reorder/import/relay;
- candidate solution остаётся редактируемым;
- free interview остаётся доступным без программы.
