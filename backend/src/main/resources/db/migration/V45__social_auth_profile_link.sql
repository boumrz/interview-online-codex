-- Login attempts keep their original purpose. Profile linking never issues a session.
ALTER TABLE social_auth_flows ADD COLUMN intent VARCHAR(16) NOT NULL DEFAULT 'login';
ALTER TABLE social_auth_flows ADD COLUMN initiating_user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE social_auth_flows ADD COLUMN initiating_session_hash VARCHAR(64);
CREATE INDEX ix_social_auth_flow_initiating_user ON social_auth_flows(initiating_user_id);

-- Historical multiple identities for one provider/user remain usable. New bindings
-- serialize on the user row; provider+subject remains the unique ownership boundary.
