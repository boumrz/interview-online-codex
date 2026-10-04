-- Library records have one lifecycle: available until explicitly deleted.
-- Existing interview room_tasks are independent snapshots and are never rewritten.
UPDATE task_presets SET status = 'ACTIVE', revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP WHERE status = 'ARCHIVED';
UPDATE team_task_templates SET status = 'ACTIVE', revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP WHERE status = 'ARCHIVED';

-- Archived sets could share a name with an active set (partial unique index).
-- Keep every ID/item and the active name; give only conflicting restored sets a suffix.
DO $$
DECLARE
    archived RECORD;
    candidate TEXT;
    candidate_normalized TEXT;
    suffix TEXT;
    attempt INTEGER;
BEGIN
    FOR archived IN SELECT id, team_id, name, normalized_name FROM team_task_sets
        WHERE status = 'ARCHIVED' ORDER BY created_at, id
    LOOP
        candidate := archived.name;
        candidate_normalized := archived.normalized_name;
        attempt := 2;
        WHILE EXISTS (SELECT 1 FROM team_task_sets
            WHERE team_id = archived.team_id AND status = 'ACTIVE'
                AND normalized_name = candidate_normalized)
        LOOP
            suffix := ' (' || attempt || ')';
            candidate := rtrim(left(archived.name, 180 - char_length(suffix))) || suffix;
            candidate_normalized := lower(normalize(candidate, NFKC));
            attempt := attempt + 1;
        END LOOP;
        UPDATE team_task_sets SET status = 'ACTIVE', name = candidate,
            normalized_name = candidate_normalized, revision = revision + 1,
            updated_at = CURRENT_TIMESTAMP WHERE id = archived.id;
    END LOOP;
END $$;

-- Removing an already used library set only detaches its live reference.
-- Keep the room's tasks, original set revision, programme provenance and results.
ALTER TABLE rooms DROP CONSTRAINT fk_rooms_team_task_set;
ALTER TABLE rooms ADD CONSTRAINT fk_rooms_team_task_set
    FOREIGN KEY (team_task_set_id) REFERENCES team_task_sets(id) ON DELETE SET NULL;
