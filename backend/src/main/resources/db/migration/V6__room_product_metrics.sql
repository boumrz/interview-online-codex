-- Server-authoritative, privacy-safe projection for aggregate interview metrics.
-- It deliberately contains no invite codes, user/session identifiers, code,
-- notes, verdict comments, keystrokes, or diagnostic payloads.

CREATE TABLE room_product_metrics (
    room_id                                  VARCHAR(255) PRIMARY KEY,
    created_at                               TIMESTAMP(6) NOT NULL,
    creation_source                          VARCHAR(32)  NOT NULL,
    initial_task_count                       INTEGER      NOT NULL,
    prepared_at                              TIMESTAMP(6),
    first_interviewer_joined_at              TIMESTAMP(6),
    first_candidate_joined_at                TIMESTAMP(6),
    first_meaningful_candidate_activity_at   TIMESTAMP(6),
    first_verdict_saved_at                   TIMESTAMP(6),
    latest_verdict_saved_at                  TIMESTAMP(6),
    realtime_connection_count                INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT fk_room_product_metrics_room
        FOREIGN KEY (room_id)
        REFERENCES rooms(id)
        ON DELETE CASCADE,
    CONSTRAINT chk_rpm_creation_source
        CHECK (creation_source IN ('guest', 'dashboard', 'legacy')),
    CONSTRAINT chk_rpm_initial_task_count
        CHECK (initial_task_count >= 0 AND initial_task_count <= 100),
    CONSTRAINT chk_rpm_realtime_connection_count
        CHECK (realtime_connection_count >= 0 AND realtime_connection_count <= 100000)
);

CREATE INDEX idx_rpm_created_at ON room_product_metrics (created_at);
CREATE INDEX idx_rpm_candidate_joined_at ON room_product_metrics (first_candidate_joined_at);
CREATE INDEX idx_rpm_activity_at ON room_product_metrics (first_meaningful_candidate_activity_at);
CREATE INDEX idx_rpm_first_verdict_at ON room_product_metrics (first_verdict_saved_at);
