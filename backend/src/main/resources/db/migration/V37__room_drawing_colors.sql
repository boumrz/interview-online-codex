-- A participant keeps its default ink color for the lifetime of the room,
-- including after disconnect and server restart. Reservations are not reused
-- while earlier drawings by that participant can still exist.
CREATE TABLE room_drawing_colors (
    room_id varchar(255) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity_key text NOT NULL,
    color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
    PRIMARY KEY (room_id, identity_key),
    UNIQUE (room_id, color)
);
