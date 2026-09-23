-- Existing team interviews created before owner room grants need the same
-- durable participant row as newly created interviews. Membership and room
-- lineage are still checked on every access.
UPDATE room_participants p
SET role = 'owner'
WHERE p.role <> 'owner'
  AND EXISTS (
    SELECT 1 FROM rooms r
    WHERE r.id = p.room_id
      AND r.team_id IS NOT NULL
      AND r.owner_user_id = p.user_id
  );

INSERT INTO room_participants (id, room_id, user_id, role, created_at)
SELECT CONCAT('team-owner-', r.id), r.id, r.owner_user_id, 'owner', r.created_at
FROM rooms r
WHERE r.team_id IS NOT NULL
  AND r.owner_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM room_participants p
    WHERE p.room_id = r.id AND p.user_id = r.owner_user_id
  );
