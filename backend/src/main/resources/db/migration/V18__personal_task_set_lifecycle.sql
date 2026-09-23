ALTER TABLE task_presets
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

CREATE INDEX IF NOT EXISTS idx_task_presets_owner_status_created
    ON task_presets (owner_user_id, status, created_at DESC, id ASC);
