-- Existing entries used normalized key/code values. Keep their replay semantics.
-- A field requiring lossless escaping takes one prefix plus four hex digits per UTF-16 unit.
ALTER TABLE room_keystroke_events
    ADD COLUMN raw_fields_preserved BOOLEAN NOT NULL DEFAULT FALSE,
    ALTER COLUMN session_id TYPE VARCHAR(255),
    ALTER COLUMN display_name TYPE VARCHAR(513),
    ALTER COLUMN key_value TYPE VARCHAR(257),
    ALTER COLUMN key_code TYPE VARCHAR(257),
    ALTER COLUMN paste_preview TYPE VARCHAR(201);
