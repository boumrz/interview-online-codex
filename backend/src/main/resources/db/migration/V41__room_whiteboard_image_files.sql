-- Assets share the board/task lifecycle and transaction with their image elements.
-- Retain tombstone assets for Undo; deleting the board removes them together.
ALTER TABLE room_whiteboards ADD COLUMN files text NOT NULL DEFAULT '{}';
