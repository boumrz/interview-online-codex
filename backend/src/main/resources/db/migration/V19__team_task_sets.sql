CREATE TABLE IF NOT EXISTS team_task_sets (
    id                 VARCHAR(255) PRIMARY KEY,
    team_id            VARCHAR(255) NOT NULL,
    name               VARCHAR(255) NOT NULL,
    normalized_name    VARCHAR(255) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    revision           BIGINT NOT NULL DEFAULT 0,
    created_by_user_id VARCHAR(255) NOT NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at         TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT fk_team_task_sets_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_task_sets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_team_task_sets_active_name
    ON team_task_sets (team_id, normalized_name)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_team_task_sets_team_status_created
    ON team_task_sets (team_id, status, created_at DESC, id ASC);

CREATE TABLE IF NOT EXISTS team_task_set_items (
    id               VARCHAR(255) PRIMARY KEY,
    task_set_id      VARCHAR(255) NOT NULL,
    task_template_id VARCHAR(255) NOT NULL,
    position         INTEGER NOT NULL,
    CONSTRAINT fk_team_task_set_items_set FOREIGN KEY (task_set_id) REFERENCES team_task_sets (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_task_set_items_task FOREIGN KEY (task_template_id) REFERENCES team_task_templates (id) ON DELETE CASCADE,
    CONSTRAINT uk_team_task_set_items_set_task UNIQUE (task_set_id, task_template_id),
    CONSTRAINT uk_team_task_set_items_set_position UNIQUE (task_set_id, position)
);

CREATE INDEX IF NOT EXISTS idx_team_task_set_items_set
    ON team_task_set_items (task_set_id, position);

CREATE INDEX IF NOT EXISTS idx_team_task_set_items_task
    ON team_task_set_items (task_template_id);
