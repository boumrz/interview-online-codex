CREATE TABLE room_diagrams (
    room_id varchar(255) PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    id varchar(36) NOT NULL UNIQUE,
    sequence bigint NOT NULL CHECK (sequence >= 0),
    xml text NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Lightweight receipts remain after recovery payloads are compacted. This
-- preserves idempotency without retaining every full XML snapshot forever.
CREATE TABLE room_diagram_operations (
    room_id varchar(255) NOT NULL REFERENCES room_diagrams(room_id) ON DELETE CASCADE,
    operation_id varchar(36) NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    session_id varchar(255) NOT NULL,
    fingerprint varchar(64) NOT NULL,
    xml text,
    patch text,
    checksum varchar(128),
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, operation_id),
    UNIQUE (room_id, sequence)
);

ALTER TABLE rooms DROP CONSTRAINT rooms_editor_mode_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_editor_mode_check
    CHECK (room_editor_mode IN ('code', 'markdown', 'diagram'));
