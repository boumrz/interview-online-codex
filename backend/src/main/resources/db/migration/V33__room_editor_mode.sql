ALTER TABLE rooms ADD COLUMN room_editor_mode varchar(16) NOT NULL DEFAULT 'code';
ALTER TABLE rooms ADD COLUMN room_editor_mode_revision bigint NOT NULL DEFAULT 0;
-- Preserve the previously published editor on upgrade; subsequent step changes
-- no longer derive the room mode from task-local Markdown markers.
UPDATE rooms SET room_editor_mode = 'markdown'
WHERE position('<!--briefing:focus=on-->' in coalesce(briefing_markdown, '')) > 0;
ALTER TABLE rooms ADD CONSTRAINT rooms_editor_mode_check CHECK (room_editor_mode IN ('code', 'markdown'));
ALTER TABLE rooms ADD CONSTRAINT rooms_editor_mode_revision_check CHECK (room_editor_mode_revision >= 0);
