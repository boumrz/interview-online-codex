CREATE TABLE room_whiteboards (
    room_id varchar(255) PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    id varchar(36) NOT NULL UNIQUE,
    sequence bigint NOT NULL CHECK (sequence >= 0),
    elements text NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A receipt contains no scene payload. No-op intents may share a sequence;
-- operation identity, rather than sequence, supplies retry idempotency.
CREATE TABLE room_whiteboard_operations (
    room_id varchar(255) NOT NULL REFERENCES room_whiteboards(room_id) ON DELETE CASCADE,
    operation_id varchar(36) NOT NULL,
    sequence bigint NOT NULL CHECK (sequence >= 0),
    fingerprint varchar(64) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, operation_id)
);

ALTER TABLE rooms DROP CONSTRAINT rooms_editor_mode_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_editor_mode_check
    CHECK (room_editor_mode IN ('code', 'markdown', 'diagram', 'whiteboard'));
