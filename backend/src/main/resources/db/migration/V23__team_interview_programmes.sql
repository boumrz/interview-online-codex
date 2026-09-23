CREATE TABLE team_interview_programmes (
    id                 VARCHAR(255) PRIMARY KEY,
    team_id            VARCHAR(255) NOT NULL,
    target_type        VARCHAR(32) NOT NULL,
    target_id          VARCHAR(255) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    version            BIGINT NOT NULL DEFAULT 0,
    revision           BIGINT NOT NULL DEFAULT 0,
    created_by_user_id VARCHAR(255) NOT NULL,
    created_at         TIMESTAMP(6) NOT NULL,
    updated_at         TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_team_interview_programmes_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_interview_programmes_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_team_interview_programmes_target_type CHECK (target_type IN ('TRACK', 'VACANCY')),
    CONSTRAINT ck_team_interview_programmes_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT ck_team_interview_programmes_version CHECK (version >= 0),
    CONSTRAINT ck_team_interview_programmes_revision CHECK (revision >= 0),
    CONSTRAINT uk_team_interview_programmes_target UNIQUE (team_id, target_type, target_id)
);

CREATE INDEX idx_team_interview_programmes_team_target
    ON team_interview_programmes (team_id, target_type, target_id);

CREATE TABLE team_interview_programme_items (
    id               VARCHAR(255) PRIMARY KEY,
    programme_id     VARCHAR(255) NOT NULL,
    task_template_id VARCHAR(255) NOT NULL,
    position         INTEGER NOT NULL,
    mandatory        BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_team_interview_programme_items_programme
        FOREIGN KEY (programme_id) REFERENCES team_interview_programmes (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_interview_programme_items_task
        FOREIGN KEY (task_template_id) REFERENCES team_task_templates (id) ON DELETE CASCADE,
    CONSTRAINT uk_team_interview_programme_items_programme_task UNIQUE (programme_id, task_template_id),
    CONSTRAINT uk_team_interview_programme_items_programme_position UNIQUE (programme_id, position)
);

CREATE INDEX idx_team_interview_programme_items_programme
    ON team_interview_programme_items (programme_id, position);

CREATE INDEX idx_team_interview_programme_items_task
    ON team_interview_programme_items (task_template_id);
