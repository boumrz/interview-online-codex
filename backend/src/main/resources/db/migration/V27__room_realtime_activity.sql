CREATE TABLE room_realtime_activity (
    id          VARCHAR(36) PRIMARY KEY,
    room_code   VARCHAR(255) NOT NULL,
    instance_id VARCHAR(36) NOT NULL,
    expires_at  TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_room_realtime_activity_instance UNIQUE (room_code, instance_id)
);

CREATE INDEX idx_room_realtime_activity_room_expiry
    ON room_realtime_activity (room_code, expires_at);
