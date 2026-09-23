ALTER TABLE rooms
    ADD COLUMN team_track_id VARCHAR(255),
    ADD COLUMN team_vacancy_id VARCHAR(255),
    ADD COLUMN team_task_set_id VARCHAR(255),
    ADD COLUMN team_task_set_revision BIGINT,
    ADD CONSTRAINT fk_rooms_team_track FOREIGN KEY (team_track_id) REFERENCES team_tracks (id),
    ADD CONSTRAINT fk_rooms_team_vacancy FOREIGN KEY (team_vacancy_id) REFERENCES team_vacancies (id),
    ADD CONSTRAINT fk_rooms_team_task_set FOREIGN KEY (team_task_set_id) REFERENCES team_task_sets (id),
    ADD CONSTRAINT ck_rooms_team_task_set_revision CHECK (team_task_set_revision IS NULL OR team_task_set_revision >= 0);

CREATE INDEX idx_rooms_team_task_set
    ON rooms (team_id, team_task_set_id, archived_at);

CREATE INDEX idx_rooms_team_track_vacancy
    ON rooms (team_id, team_track_id, team_vacancy_id, archived_at);

ALTER TABLE room_product_metrics
    DROP CONSTRAINT chk_rpm_creation_source,
    ADD CONSTRAINT chk_rpm_creation_source
        CHECK (creation_source IN ('guest', 'dashboard', 'legacy', 'team'));
