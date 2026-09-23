CREATE TABLE team_merge_plans (
    id                    VARCHAR(255) PRIMARY KEY,
    source_team_id        VARCHAR(255) NOT NULL REFERENCES teams (id),
    target_team_id        VARCHAR(255) NOT NULL REFERENCES teams (id),
    destination_team_id   VARCHAR(255) NOT NULL REFERENCES teams (id),
    destination_name      VARCHAR(255) NOT NULL,
    source_merge_revision BIGINT NOT NULL,
    target_merge_revision BIGINT NOT NULL,
    source_snapshot_hash  VARCHAR(64) NOT NULL,
    target_snapshot_hash  VARCHAR(64) NOT NULL,
    track_renames_json    TEXT NOT NULL DEFAULT '{}',
    set_renames_json      TEXT NOT NULL DEFAULT '{}',
    admin_promotions_json TEXT NOT NULL DEFAULT '[]',
    state                 VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW',
    reviewed_at           TIMESTAMP(6),
    source_approved_at    TIMESTAMP(6),
    target_approved_at    TIMESTAMP(6),
    committed_at          TIMESTAMP(6),
    commit_key            VARCHAR(36),
    commit_actor_user_id  VARCHAR(255) REFERENCES users (id),
    created_at            TIMESTAMP(6) NOT NULL,
    updated_at            TIMESTAMP(6) NOT NULL,
    CONSTRAINT ck_team_merge_plan_distinct CHECK (source_team_id <> target_team_id),
    CONSTRAINT ck_team_merge_plan_destination CHECK (destination_team_id IN (source_team_id, target_team_id)),
    CONSTRAINT ck_team_merge_plan_state CHECK (state IN ('PENDING_REVIEW', 'REVIEWING', 'READY', 'STALE', 'COMMITTED'))
);

CREATE UNIQUE INDEX uk_team_merge_plans_commit_attempt
    ON team_merge_plans (commit_actor_user_id, commit_key)
    WHERE commit_key IS NOT NULL;

CREATE INDEX idx_team_merge_plans_source ON team_merge_plans (source_team_id, created_at DESC);
CREATE INDEX idx_team_merge_plans_target ON team_merge_plans (target_team_id, created_at DESC);
