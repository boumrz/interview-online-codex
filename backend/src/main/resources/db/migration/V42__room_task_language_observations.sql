CREATE TABLE room_task_language_observations (
    id VARCHAR(255) PRIMARY KEY,
    room_id VARCHAR(255) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    task_id VARCHAR(255) NOT NULL,
    language VARCHAR(16) NOT NULL CHECK (language IN ('nodejs','python','kotlin','java','sql','plaintext')),
    observed_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_room_task_language UNIQUE (room_id, language, task_id)
);
