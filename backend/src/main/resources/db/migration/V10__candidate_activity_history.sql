-- History cursors use acceptance order, independently of the display timestamp.
-- Preserve already accepted identities/sequences; repair only legacy nulls.
UPDATE room_keystroke_events
SET source_event_id = id
WHERE source_event_id IS NULL;

WITH room_maxima AS (
    SELECT room_id, COALESCE(MAX(accepted_sequence), 0) AS maximum_sequence
    FROM room_keystroke_events
    GROUP BY room_id
), missing_sequences AS (
    SELECT event.id,
           room_maxima.maximum_sequence + ROW_NUMBER() OVER (
               PARTITION BY event.room_id
               ORDER BY event.timestamp_epoch_ms, event.id
           ) AS accepted_sequence
    FROM room_keystroke_events event
    JOIN room_maxima ON room_maxima.room_id = event.room_id
    WHERE event.accepted_sequence IS NULL
)
UPDATE room_keystroke_events event
SET accepted_sequence = missing_sequences.accepted_sequence
FROM missing_sequences
WHERE event.id = missing_sequences.id AND event.accepted_sequence IS NULL;

CREATE INDEX IF NOT EXISTS idx_rke_room_accepted_sequence
    ON room_keystroke_events (room_id, accepted_sequence);
