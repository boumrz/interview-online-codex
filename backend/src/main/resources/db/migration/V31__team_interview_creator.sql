-- Interview ownership can change, so retain the original creator separately.
ALTER TABLE rooms ADD COLUMN created_by_user_id VARCHAR(255);

-- The first owner grant is the best surviving provenance for older team rooms.
UPDATE rooms r
SET created_by_user_id = COALESCE(
    (SELECT p.user_id
     FROM room_participants p
     WHERE p.room_id = r.id AND p.role = 'owner'
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT 1),
    r.owner_user_id
)
WHERE r.team_id IS NOT NULL;
