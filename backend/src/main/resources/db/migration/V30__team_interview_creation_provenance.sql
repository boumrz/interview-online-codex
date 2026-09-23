-- Team origin alone is not proof that a room was created through the team
-- interview flow: older personal rooms can be re-scoped by legacy operations.
ALTER TABLE rooms
    ADD COLUMN team_interview_created BOOLEAN NOT NULL DEFAULT FALSE;

-- Previous team interviews always had a task set. Newer interviews without
-- a set have a durable team creation-source projection.
UPDATE rooms r
SET team_interview_created = TRUE
WHERE r.team_id IS NOT NULL
  AND r.origin_team_id IS NOT NULL
  AND (
      r.team_task_set_id IS NOT NULL
      OR EXISTS (
          SELECT 1 FROM room_product_metrics m
          WHERE m.room_id = r.id
            AND m.creation_source = 'team'
      )
  );
