ALTER TABLE users ADD COLUMN IF NOT EXISTS is_hr BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS candidate_name VARCHAR(200);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS position VARCHAR(200);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP(6);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP(6);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS interview_metadata_revision BIGINT NOT NULL DEFAULT 0;

UPDATE rooms room
SET finished_at = metric.first_verdict_saved_at
FROM room_product_metrics metric
WHERE metric.room_id = room.id
  AND metric.first_verdict_saved_at IS NOT NULL
  AND (room.finished_at IS NULL OR metric.first_verdict_saved_at < room.finished_at);

CREATE TABLE IF NOT EXISTS room_hr_assignments (
    id VARCHAR(255) PRIMARY KEY,
    room_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_room_hr_assignments_room_user UNIQUE (room_id, user_id),
    CONSTRAINT fk_room_hr_assignments_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE,
    CONSTRAINT fk_room_hr_assignments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_hr_assignments_user_room ON room_hr_assignments (user_id, room_id);
