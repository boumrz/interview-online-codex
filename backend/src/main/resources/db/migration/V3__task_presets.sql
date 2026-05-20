-- V3__task_presets.sql
-- Adds task_presets and preset_items tables.
-- Compatible with both PostgreSQL and H2.
-- Case-insensitive name uniqueness is enforced at service layer;
-- the DB unique constraint covers exact-case duplicates as a backstop.

CREATE TABLE IF NOT EXISTS task_presets (
    id            VARCHAR(255) PRIMARY KEY,
    owner_user_id VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_task_presets_owner FOREIGN KEY (owner_user_id) REFERENCES users (id),
    CONSTRAINT uk_task_presets_owner_name UNIQUE (owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_task_presets_owner_user_id ON task_presets (owner_user_id);

CREATE TABLE IF NOT EXISTS preset_items (
    id               VARCHAR(255) PRIMARY KEY,
    preset_id        VARCHAR(255) NOT NULL,
    task_template_id VARCHAR(255) NOT NULL,
    position         INTEGER      NOT NULL,
    CONSTRAINT fk_preset_items_preset   FOREIGN KEY (preset_id)        REFERENCES task_presets        (id) ON DELETE CASCADE,
    CONSTRAINT fk_preset_items_template FOREIGN KEY (task_template_id) REFERENCES user_task_templates (id) ON DELETE CASCADE,
    CONSTRAINT uk_preset_items_preset_template UNIQUE (preset_id, task_template_id)
);

CREATE INDEX IF NOT EXISTS idx_preset_items_preset_id        ON preset_items (preset_id);
CREATE INDEX IF NOT EXISTS idx_preset_items_task_template_id ON preset_items (task_template_id);
