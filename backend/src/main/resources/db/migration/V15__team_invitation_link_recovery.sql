ALTER TABLE team_invitations
    ADD COLUMN recoverable_token_envelope VARCHAR(512),
    ADD COLUMN recovery_key_version VARCHAR(64),
    ADD CONSTRAINT ck_team_invitations_recovery_pair CHECK (
        (recoverable_token_envelope IS NULL AND recovery_key_version IS NULL)
        OR (recoverable_token_envelope IS NOT NULL AND recovery_key_version IS NOT NULL)
    );

CREATE INDEX idx_team_invitations_state_expires_id
    ON team_invitations (state, expires_at, id);
