-- Initial team-workspace storage. Existing records remain personal and are not backfilled.

CREATE TABLE teams (
    id                VARCHAR(255) PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    normalized_name   VARCHAR(255) NOT NULL,
    owner_user_id     VARCHAR(255) NOT NULL,
    state             VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    merged_into_team_id VARCHAR(255),
    merged_at         TIMESTAMP(6),
    revision          BIGINT NOT NULL DEFAULT 0,
    security_revision BIGINT NOT NULL DEFAULT 0,
    merge_revision    BIGINT NOT NULL DEFAULT 0,
    created_at        TIMESTAMP(6) NOT NULL,
    updated_at        TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_teams_owner_user FOREIGN KEY (owner_user_id) REFERENCES users (id),
    CONSTRAINT fk_teams_merged_into FOREIGN KEY (merged_into_team_id) REFERENCES teams (id),
    CONSTRAINT ck_teams_state CHECK (state IN ('ACTIVE', 'MERGED')),
    CONSTRAINT ck_teams_revision CHECK (revision >= 0),
    CONSTRAINT ck_teams_security_revision CHECK (security_revision >= 0),
    CONSTRAINT ck_teams_merge_revision CHECK (merge_revision >= 0)
);

CREATE TABLE team_memberships (
    id          VARCHAR(255) PRIMARY KEY,
    team_id     VARCHAR(255) NOT NULL,
    user_id     VARCHAR(255) NOT NULL,
    role        VARCHAR(32) NOT NULL,
    state       VARCHAR(32) NOT NULL,
    epoch       BIGINT NOT NULL DEFAULT 0,
    revision    BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMP(6) NOT NULL,
    updated_at  TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_team_memberships_team FOREIGN KEY (team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_memberships_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT uk_team_memberships_team_user UNIQUE (team_id, user_id),
    CONSTRAINT ck_team_memberships_role CHECK (role IN ('ADMIN', 'MEMBER')),
    CONSTRAINT ck_team_memberships_state CHECK (state IN ('ACTIVE', 'SUSPENDED', 'LEFT', 'REMOVED')),
    CONSTRAINT ck_team_memberships_epoch CHECK (epoch >= 0),
    CONSTRAINT ck_team_memberships_revision CHECK (revision >= 0)
);

CREATE INDEX idx_team_memberships_user_state_team
    ON team_memberships (user_id, state, team_id);

CREATE TABLE team_audit_events (
    id                VARCHAR(255) PRIMARY KEY,
    team_id           VARCHAR(255) NOT NULL,
    origin_team_id    VARCHAR(255) NOT NULL,
    actor_user_id     VARCHAR(255) NOT NULL,
    target_user_id    VARCHAR(255),
    action            VARCHAR(64) NOT NULL,
    created_at        TIMESTAMP(6) NOT NULL,
    outcome           VARCHAR(32) NOT NULL,
    opaque_entity_id  VARCHAR(255),
    CONSTRAINT fk_team_audit_events_team FOREIGN KEY (team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_audit_events_origin_team FOREIGN KEY (origin_team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_audit_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id),
    CONSTRAINT fk_team_audit_events_target FOREIGN KEY (target_user_id) REFERENCES users (id)
);

CREATE INDEX idx_team_audit_events_team_created_id
    ON team_audit_events (team_id, created_at, id);

CREATE TABLE command_receipts (
    receipt_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   VARCHAR(255) NOT NULL,
    scope_kind      VARCHAR(32) NOT NULL,
    scope_id        VARCHAR(255) NOT NULL,
    operation       VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(36) NOT NULL,
    request_hash    VARCHAR(67) NOT NULL,
    outcome         VARCHAR(32) NOT NULL,
    status          INTEGER NOT NULL,
    resource_id     VARCHAR(255) NOT NULL,
    created_at      TIMESTAMP(6) NOT NULL,
    expires_at      TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_command_receipts_namespace UNIQUE
        (actor_user_id, scope_kind, scope_id, operation, idempotency_key),
    CONSTRAINT fk_command_receipts_actor FOREIGN KEY (actor_user_id) REFERENCES users (id),
    CONSTRAINT ck_command_receipts_scope_kind CHECK (scope_kind IN ('PERSONAL', 'TEAM')),
    CONSTRAINT ck_command_receipts_status CHECK (status BETWEEN 100 AND 599),
    CONSTRAINT ck_command_receipts_hash CHECK (request_hash ~ '^v1:[0-9a-f]{64}$'),
    CONSTRAINT ck_command_receipts_expiry CHECK (expires_at = created_at + INTERVAL '24 hours')
);

ALTER TABLE rooms
    ADD COLUMN team_id VARCHAR(255),
    ADD COLUMN origin_team_id VARCHAR(255),
    ADD CONSTRAINT fk_rooms_team FOREIGN KEY (team_id) REFERENCES teams (id),
    ADD CONSTRAINT fk_rooms_origin_team FOREIGN KEY (origin_team_id) REFERENCES teams (id),
    ADD CONSTRAINT ck_rooms_team_scope CHECK (
        (team_id IS NULL AND origin_team_id IS NULL)
        OR (team_id IS NOT NULL AND origin_team_id IS NOT NULL)
    );

CREATE INDEX idx_rooms_team_archived
    ON rooms (team_id, archived_at);
