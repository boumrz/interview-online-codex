-- Durable, manager-only preparation workspace for an inactive room task.
-- All columns are additive so older tasks safely fall back to their existing
-- solution_code / solution_language / briefing_markdown values.
ALTER TABLE room_tasks
    ADD COLUMN IF NOT EXISTS workspace_yjs_document_base64 TEXT,
    ADD COLUMN IF NOT EXISTS workspace_yjs_sequence BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS workspace_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS workspace_focus_mode BOOLEAN;
