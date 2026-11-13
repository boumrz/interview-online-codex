ALTER TABLE room_whiteboards ADD COLUMN task_id varchar(255);

-- Keep the former room-wide scene on the published task, with its identity,
-- sequence and receipts. A room without tasks keeps its own scene.
UPDATE room_whiteboards b
SET task_id = (SELECT t.id FROM room_tasks t JOIN rooms r ON r.id=t.room_id
               WHERE t.room_id=b.room_id
               ORDER BY (t.step_index=r.current_step) DESC, t.step_index, t.id LIMIT 1);

ALTER TABLE room_whiteboard_operations ADD COLUMN board_id varchar(36);
UPDATE room_whiteboard_operations op SET board_id=b.id
FROM room_whiteboards b WHERE op.room_id=b.room_id;
ALTER TABLE room_whiteboard_operations
    ALTER COLUMN board_id SET NOT NULL,
    DROP CONSTRAINT room_whiteboard_operations_room_id_fkey,
    DROP CONSTRAINT room_whiteboard_operations_pkey;

ALTER TABLE room_whiteboards
    DROP CONSTRAINT room_whiteboards_pkey,
    DROP CONSTRAINT room_whiteboards_id_key,
    ADD PRIMARY KEY (id),
    ADD UNIQUE (id, room_id),
    ADD UNIQUE NULLS NOT DISTINCT (room_id, task_id),
    ADD FOREIGN KEY (room_id, task_id) REFERENCES room_tasks(room_id, id) ON DELETE CASCADE;

ALTER TABLE room_whiteboard_operations
    ADD PRIMARY KEY (board_id, operation_id),
    ADD FOREIGN KEY (board_id, room_id) REFERENCES room_whiteboards(id, room_id) ON DELETE CASCADE;
