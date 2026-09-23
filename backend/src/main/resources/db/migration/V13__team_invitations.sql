CREATE TABLE team_invitations (
    id              VARCHAR(255) PRIMARY KEY,
    team_id         VARCHAR(255) NOT NULL,
    token_hash      VARCHAR(64) NOT NULL,
    creator_user_id VARCHAR(255) NOT NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'MEMBER',
    expires_at      TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    state           VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    accepted_by     VARCHAR(255),
    accepted_at     TIMESTAMP(6) WITH TIME ZONE,
    revision        BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    updated_at      TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_team_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_team_invitations_team FOREIGN KEY (team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_invitations_creator FOREIGN KEY (creator_user_id) REFERENCES users (id),
    CONSTRAINT fk_team_invitations_accepted_by FOREIGN KEY (accepted_by) REFERENCES users (id),
    CONSTRAINT ck_team_invitations_role CHECK (role = 'MEMBER'),
    CONSTRAINT ck_team_invitations_state CHECK (state IN ('PENDING', 'ACCEPTED', 'REVOKED')),
    CONSTRAINT ck_team_invitations_revision CHECK (revision >= 0),
    CONSTRAINT ck_team_invitations_acceptance CHECK (
        (state = 'ACCEPTED' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
        OR (state <> 'ACCEPTED' AND accepted_by IS NULL AND accepted_at IS NULL)
    )
);

CREATE INDEX idx_team_invitations_team_created_id
    ON team_invitations (team_id, created_at DESC, id);

CREATE INDEX idx_team_invitations_creator_state
    ON team_invitations (creator_user_id, state);
