-- Durable source identity and room-local acceptance ordering for raw activity.
-- The columns remain nullable during rollout so older history and clients remain
-- readable; the server mints values for every newly accepted event.

ALTER TABLE room_keystroke_events
    ADD COLUMN IF NOT EXISTS source_event_id VARCHAR(36);

ALTER TABLE room_keystroke_events
    ADD COLUMN IF NOT EXISTS accepted_sequence BIGINT;

-- Backfill existing history deterministically. Existing event IDs are UUIDs and
-- become their legacy source identities; the stable ID tie-break makes equal
-- timestamps reproducible.
UPDATE room_keystroke_events
SET source_event_id = id
WHERE source_event_id IS NULL;

WITH ranked_events AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY room_id
            ORDER BY timestamp_epoch_ms ASC, id ASC
        ) AS next_accepted_sequence
    FROM room_keystroke_events
)
UPDATE room_keystroke_events AS event
SET accepted_sequence = ranked_events.next_accepted_sequence
FROM ranked_events
WHERE event.id = ranked_events.id
  AND event.accepted_sequence IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_rke_room_source_event
    ON room_keystroke_events (room_id, source_event_id)
    WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rke_room_ts_accepted_sequence
    ON room_keystroke_events (room_id, timestamp_epoch_ms, accepted_sequence);
