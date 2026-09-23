CREATE INDEX idx_room_realtime_activity_expiry
    ON room_realtime_activity (expires_at);
