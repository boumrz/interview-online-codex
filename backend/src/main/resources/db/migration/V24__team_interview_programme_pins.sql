ALTER TABLE rooms
    ADD COLUMN team_interview_programme_id VARCHAR(255),
    ADD COLUMN team_interview_programme_origin VARCHAR(32),
    ADD COLUMN team_interview_programme_version BIGINT,
    ADD CONSTRAINT fk_rooms_team_interview_programme
        FOREIGN KEY (team_interview_programme_id) REFERENCES team_interview_programmes (id),
    ADD CONSTRAINT ck_rooms_team_interview_programme_origin
        CHECK (team_interview_programme_origin IS NULL OR team_interview_programme_origin IN ('TRACK', 'VACANCY')),
    ADD CONSTRAINT ck_rooms_team_interview_programme_version
        CHECK (team_interview_programme_version IS NULL OR team_interview_programme_version >= 0);

CREATE INDEX idx_rooms_team_interview_programme
    ON rooms (team_id, team_interview_programme_id, team_interview_programme_version);

ALTER TABLE room_tasks
    ADD COLUMN mandatory BOOLEAN NOT NULL DEFAULT FALSE;
