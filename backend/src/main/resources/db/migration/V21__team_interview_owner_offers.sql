CREATE TABLE team_interview_owner_offers (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams (id),
    room_id VARCHAR(255) NOT NULL REFERENCES rooms (id),
    from_user_id VARCHAR(255) NOT NULL REFERENCES users (id),
    to_user_id VARCHAR(255) NOT NULL REFERENCES users (id),
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    responded_at TIMESTAMP,
    CONSTRAINT ck_team_interview_owner_offer_status
        CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
    CONSTRAINT ck_team_interview_owner_offer_expiry
        CHECK (expires_at > created_at)
);

CREATE INDEX idx_team_interview_owner_offers_target
    ON team_interview_owner_offers (team_id, to_user_id, status, expires_at);

CREATE INDEX idx_team_interview_owner_offers_room
    ON team_interview_owner_offers (team_id, room_id, status, expires_at);
