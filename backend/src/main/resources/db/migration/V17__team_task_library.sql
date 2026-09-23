CREATE TABLE team_task_templates (
    id                 VARCHAR(255) PRIMARY KEY,
    team_id            VARCHAR(255) NOT NULL,
    title              VARCHAR(255) NOT NULL,
    normalized_title   VARCHAR(255) NOT NULL,
    description        TEXT NOT NULL,
    starter_code       TEXT NOT NULL,
    language           VARCHAR(255) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    revision           BIGINT NOT NULL DEFAULT 0,
    created_by_user_id VARCHAR(255) NOT NULL,
    created_at         TIMESTAMP(6) NOT NULL,
    updated_at         TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_team_task_templates_team FOREIGN KEY (team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_task_templates_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_team_task_templates_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_team_task_templates_revision CHECK (revision >= 0)
);

CREATE INDEX idx_team_task_templates_team_status_created
    ON team_task_templates (team_id, status, created_at DESC, id);

CREATE INDEX idx_team_task_templates_team_status_language_created
    ON team_task_templates (team_id, status, language, created_at DESC, id);
