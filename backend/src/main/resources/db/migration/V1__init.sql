-- V1__init.sql
-- Baseline migration: creates all tables and FK-indexes.
-- Uses IF NOT EXISTS throughout so this script is safe to run
-- against an already-populated production database (baseline-on-migrate=true).

-- ─────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(255) PRIMARY KEY,
    nickname      VARCHAR(255) NOT NULL,
    display_name  VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(32)  NOT NULL,
    created_at    TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_users_nickname UNIQUE (nickname)
);

-- ─────────────────────────────────────────────
-- user_sessions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
    id         VARCHAR(255) PRIMARY KEY,
    user_id    VARCHAR(255) NOT NULL,
    token      VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_user_sessions_token UNIQUE (token),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);

-- ─────────────────────────────────────────────
-- rooms
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
    id                        VARCHAR(255) PRIMARY KEY,
    title                     VARCHAR(255) NOT NULL,
    invite_code               VARCHAR(255) NOT NULL,
    owner_session_token       VARCHAR(255) NOT NULL,
    interviewer_session_token VARCHAR(255) NOT NULL,
    owner_user_id             VARCHAR(255),
    language                  VARCHAR(255) NOT NULL,
    current_step              INTEGER      NOT NULL,
    code                      TEXT         NOT NULL,
    notes                     TEXT,
    interviewer_chat          TEXT,
    briefing_markdown         TEXT,
    candidate_key_history     TEXT,
    private_notes_json        TEXT,
    created_at                TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_rooms_invite_code UNIQUE (invite_code),
    CONSTRAINT fk_rooms_owner_user FOREIGN KEY (owner_user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_rooms_owner_user_id ON rooms (owner_user_id);

-- ─────────────────────────────────────────────
-- room_tasks
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_tasks (
    id                      VARCHAR(255) PRIMARY KEY,
    room_id                 VARCHAR(255) NOT NULL,
    step_index              INTEGER      NOT NULL,
    title                   VARCHAR(255) NOT NULL,
    description             TEXT         NOT NULL,
    starter_code            TEXT         NOT NULL,
    solution_code           TEXT,
    interviewer_notes       TEXT,
    private_notes_json      TEXT,
    briefing_markdown       TEXT,
    solution_language       VARCHAR(255),
    score                   INTEGER,
    source_task_template_id VARCHAR(255),
    language                VARCHAR(255) NOT NULL,
    category_name           VARCHAR(255),
    CONSTRAINT fk_room_tasks_room FOREIGN KEY (room_id) REFERENCES rooms (id)
);

CREATE INDEX IF NOT EXISTS idx_room_tasks_room_id ON room_tasks (room_id);

-- ─────────────────────────────────────────────
-- room_participants
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_participants (
    id         VARCHAR(255) PRIMARY KEY,
    room_id    VARCHAR(255) NOT NULL,
    user_id    VARCHAR(255) NOT NULL,
    role       VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_room_participants_room_user UNIQUE (room_id, user_id),
    CONSTRAINT fk_room_participants_room FOREIGN KEY (room_id) REFERENCES rooms (id),
    CONSTRAINT fk_room_participants_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants (room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id ON room_participants (user_id);

-- ─────────────────────────────────────────────
-- user_task_categories
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_task_categories (
    id            VARCHAR(255) PRIMARY KEY,
    owner_user_id VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_user_task_categories_owner FOREIGN KEY (owner_user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_user_task_categories_owner_user_id ON user_task_categories (owner_user_id);

-- ─────────────────────────────────────────────
-- user_task_templates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_task_templates (
    id            VARCHAR(255) PRIMARY KEY,
    owner_user_id VARCHAR(255) NOT NULL,
    category_id   VARCHAR(255) NOT NULL,
    title         VARCHAR(255) NOT NULL,
    description   TEXT         NOT NULL,
    starter_code  TEXT         NOT NULL,
    language      VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_user_task_templates_owner FOREIGN KEY (owner_user_id) REFERENCES users (id),
    CONSTRAINT fk_user_task_templates_category FOREIGN KEY (category_id) REFERENCES user_task_categories (id)
);

CREATE INDEX IF NOT EXISTS idx_user_task_templates_category ON user_task_templates (category_id);
CREATE INDEX IF NOT EXISTS idx_user_task_templates_owner_user_id ON user_task_templates (owner_user_id);

-- ─────────────────────────────────────────────
-- agent_task_runs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_task_runs (
    id                      VARCHAR(255) PRIMARY KEY,
    linear_issue_id         VARCHAR(255) NOT NULL,
    workflow_provider       VARCHAR(255) NOT NULL,
    workflow_name           VARCHAR(255) NOT NULL,
    current_state           VARCHAR(255) NOT NULL,
    requires_human_approval BOOLEAN      NOT NULL,
    human_approved          BOOLEAN      NOT NULL,
    retry_count             INTEGER      NOT NULL,
    max_retries             INTEGER      NOT NULL,
    timeout_seconds         INTEGER      NOT NULL,
    assigned_role           VARCHAR(255),
    trace_id                VARCHAR(255) NOT NULL,
    acceptance_criteria     JSONB        NOT NULL,
    context_payload         JSONB        NOT NULL,
    last_handoff_reason     TEXT,
    last_error              TEXT,
    created_by              VARCHAR(255) NOT NULL,
    created_at              TIMESTAMP(6) NOT NULL,
    updated_at              TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_task_runs_linear_issue ON agent_task_runs (linear_issue_id);

-- ─────────────────────────────────────────────
-- agent_artifacts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_artifacts (
    id              VARCHAR(255) PRIMARY KEY,
    run_id          VARCHAR(255) NOT NULL,
    linear_issue_id VARCHAR(255) NOT NULL,
    artifact_type   VARCHAR(255) NOT NULL,
    artifact_key    VARCHAR(255),
    schema_version  VARCHAR(255) NOT NULL,
    payload         JSONB        NOT NULL,
    created_by      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_agent_artifacts_run FOREIGN KEY (run_id) REFERENCES agent_task_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run_id ON agent_artifacts (run_id);

-- ─────────────────────────────────────────────
-- agent_review_verdicts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_review_verdicts (
    id              VARCHAR(255) PRIMARY KEY,
    run_id          VARCHAR(255) NOT NULL,
    linear_issue_id VARCHAR(255) NOT NULL,
    reviewer_type   VARCHAR(255) NOT NULL,
    decision        VARCHAR(255) NOT NULL,
    is_blocking     BOOLEAN      NOT NULL,
    summary         TEXT         NOT NULL,
    payload         JSONB        NOT NULL,
    created_by      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_agent_review_verdicts_run FOREIGN KEY (run_id) REFERENCES agent_task_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_agent_review_verdicts_run_id ON agent_review_verdicts (run_id);

-- ─────────────────────────────────────────────
-- agent_trace_events
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_trace_events (
    id              VARCHAR(255) PRIMARY KEY,
    run_id          VARCHAR(255) NOT NULL,
    linear_issue_id VARCHAR(255) NOT NULL,
    trace_id        VARCHAR(255) NOT NULL,
    span_name       VARCHAR(255) NOT NULL,
    event_type      VARCHAR(255) NOT NULL,
    payload         JSONB        NOT NULL,
    created_at      TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_agent_trace_events_run FOREIGN KEY (run_id) REFERENCES agent_task_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_events_run_id ON agent_trace_events (run_id);
