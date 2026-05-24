-- V4__verdict_and_keystroke_events.sql
-- Adds verdict/status columns to rooms and creates room_keystroke_events table.
-- Compatible with PostgreSQL and H2 (Flyway disabled in local/H2 profile).

-- ─────────────────────────────────────────────
-- Verdict fields on rooms
-- ─────────────────────────────────────────────
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS verdict VARCHAR(32);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS verdict_comment TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status VARCHAR(32);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP(6);

-- ─────────────────────────────────────────────
-- Full keystroke timeline
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_keystroke_events (
    id                 VARCHAR(255) PRIMARY KEY,
    room_id            VARCHAR(255) NOT NULL,
    session_id         VARCHAR(128) NOT NULL,
    display_name       VARCHAR(128) NOT NULL,
    key_value          VARCHAR(64),
    key_code           VARCHAR(64),
    ctrl_key           BOOLEAN      NOT NULL DEFAULT FALSE,
    alt_key            BOOLEAN      NOT NULL DEFAULT FALSE,
    shift_key          BOOLEAN      NOT NULL DEFAULT FALSE,
    meta_key           BOOLEAN      NOT NULL DEFAULT FALSE,
    event_kind         VARCHAR(32)  NOT NULL,
    paste_length       INTEGER,
    paste_preview      VARCHAR(50),
    timestamp_epoch_ms BIGINT       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rke_room_ts ON room_keystroke_events (room_id, timestamp_epoch_ms);
