-- Only internal context and hashes are retained for the existing ten-minute flow.
ALTER TABLE social_auth_flows ADD COLUMN return_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE social_auth_flows ADD COLUMN return_room_id VARCHAR(255) REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE social_auth_flows ADD COLUMN return_team_id VARCHAR(255);
ALTER TABLE social_auth_flows ADD COLUMN return_invite_hash VARCHAR(64);
ALTER TABLE social_auth_flows ADD COLUMN completed_session_hash VARCHAR(64);
