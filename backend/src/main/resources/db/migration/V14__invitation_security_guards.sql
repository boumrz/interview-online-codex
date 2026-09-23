-- Durable, replica-safe invitation abuse counters and the D2 invitation lookup index.

CREATE INDEX idx_team_invitations_team_state_expires
    ON team_invitations (team_id, state, expires_at);

CREATE TABLE invitation_rate_limit_buckets (
    dimension         VARCHAR(32) NOT NULL,
    subject_hash      VARCHAR(64) NOT NULL,
    window_started_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    request_count     INTEGER NOT NULL,
    updated_at        TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_invitation_rate_limit_buckets PRIMARY KEY (dimension, subject_hash),
    CONSTRAINT ck_invitation_rate_limit_dimension CHECK (
        dimension IN ('PREVIEW_IP', 'PREVIEW_ACCOUNT', 'ACCEPT_IP', 'ACCEPT_ACCOUNT', 'ISSUE_TEAM')
    ),
    CONSTRAINT ck_invitation_rate_limit_subject_hash CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_invitation_rate_limit_request_count CHECK (request_count > 0)
);

CREATE INDEX idx_invitation_rate_limit_updated
    ON invitation_rate_limit_buckets (updated_at);
