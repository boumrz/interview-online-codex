CREATE TABLE team_tracks (
    id                 VARCHAR(255) PRIMARY KEY,
    team_id            VARCHAR(255) NOT NULL,
    name               VARCHAR(255) NOT NULL,
    normalized_name    VARCHAR(255) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    revision           BIGINT NOT NULL DEFAULT 0,
    created_by_user_id VARCHAR(255) NOT NULL,
    created_at         TIMESTAMP(6) NOT NULL,
    updated_at         TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_team_tracks_team FOREIGN KEY (team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_tracks_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_team_tracks_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_team_tracks_revision CHECK (revision >= 0)
);

CREATE UNIQUE INDEX uk_team_tracks_active_name
    ON team_tracks (team_id, normalized_name)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_team_tracks_team_status_name
    ON team_tracks (team_id, status, normalized_name, id);

CREATE TABLE team_vacancies (
    id                 VARCHAR(255) PRIMARY KEY,
    team_id            VARCHAR(255) NOT NULL,
    track_id           VARCHAR(255) NOT NULL,
    title              VARCHAR(255) NOT NULL,
    normalized_title   VARCHAR(255) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    revision           BIGINT NOT NULL DEFAULT 0,
    created_by_user_id VARCHAR(255) NOT NULL,
    created_at         TIMESTAMP(6) NOT NULL,
    updated_at         TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_team_vacancies_team FOREIGN KEY (team_id) REFERENCES teams (id),
    CONSTRAINT fk_team_vacancies_track FOREIGN KEY (track_id) REFERENCES team_tracks (id),
    CONSTRAINT fk_team_vacancies_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_team_vacancies_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_team_vacancies_revision CHECK (revision >= 0)
);

CREATE UNIQUE INDEX uk_team_vacancies_active_title
    ON team_vacancies (track_id, normalized_title)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_team_vacancies_track_status_title
    ON team_vacancies (track_id, status, normalized_title, id);
