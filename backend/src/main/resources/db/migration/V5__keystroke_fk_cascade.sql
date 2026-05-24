-- V5__keystroke_fk_cascade.sql
-- Adds a foreign-key constraint from room_keystroke_events.room_id → rooms.id
-- with ON DELETE CASCADE so that deleting a room automatically removes all
-- associated keystroke rows.
--
-- PostgreSQL only — Flyway is disabled in the local/H2 profile.
-- The Java-side explicit delete in RoomService.deleteRoomForUser() covers H2.

ALTER TABLE room_keystroke_events
    ADD CONSTRAINT fk_rke_room
    FOREIGN KEY (room_id)
    REFERENCES rooms(id)
    ON DELETE CASCADE;
