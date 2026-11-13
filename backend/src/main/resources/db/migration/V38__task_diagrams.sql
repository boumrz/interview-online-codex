-- A stable room task owns each canvas. A null task is the empty-room workspace.
ALTER TABLE room_tasks ADD CONSTRAINT room_tasks_room_id_id_key UNIQUE (room_id, id);
ALTER TABLE room_diagrams ADD COLUMN task_id varchar(255);

-- The old shared diagram has no task history: keep it exactly once, on the
-- currently published task (or the first surviving task for an invalid index).
UPDATE room_diagrams d SET task_id = (
    SELECT t.id FROM room_tasks t JOIN rooms r ON r.id = t.room_id
    WHERE t.room_id = d.room_id
    ORDER BY (t.step_index = r.current_step) DESC, t.step_index, t.id LIMIT 1
);

ALTER TABLE room_diagram_operations ADD COLUMN diagram_id varchar(36);
UPDATE room_diagram_operations o SET diagram_id = d.id FROM room_diagrams d WHERE d.room_id = o.room_id;
ALTER TABLE room_diagram_operations
    ALTER COLUMN diagram_id SET NOT NULL,
    DROP CONSTRAINT room_diagram_operations_room_id_fkey,
    DROP CONSTRAINT room_diagram_operations_pkey,
    DROP CONSTRAINT room_diagram_operations_room_id_sequence_key;

ALTER TABLE room_diagrams
    DROP CONSTRAINT room_diagrams_pkey,
    DROP CONSTRAINT room_diagrams_id_key,
    ADD PRIMARY KEY (id),
    ADD UNIQUE (room_id, id),
    ADD UNIQUE NULLS NOT DISTINCT (room_id, task_id),
    ADD FOREIGN KEY (room_id, task_id) REFERENCES room_tasks(room_id, id) ON DELETE CASCADE;

ALTER TABLE room_diagram_operations
    ADD PRIMARY KEY (diagram_id, operation_id),
    ADD UNIQUE (diagram_id, sequence),
    ADD FOREIGN KEY (room_id, diagram_id) REFERENCES room_diagrams(room_id, id) ON DELETE CASCADE;
