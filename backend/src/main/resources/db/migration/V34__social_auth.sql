-- Social-only accounts retain the same user ID and do not receive a local password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE social_auth_identities (
    id VARCHAR(255) PRIMARY KEY,
    provider VARCHAR(16) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_social_auth_subject UNIQUE (provider, subject)
);
CREATE INDEX ix_social_auth_user ON social_auth_identities(user_id);

-- Only hashes of state/browser proof are stored. No OAuth code or provider tokens.
CREATE TABLE social_auth_flows (
    id VARCHAR(255) PRIMARY KEY,
    provider VARCHAR(16) NOT NULL,
    state_hash VARCHAR(64) NOT NULL UNIQUE,
    browser_proof_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    subject VARCHAR(255),
    display_name VARCHAR(64),
    created_at TIMESTAMP(6) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL
);
CREATE INDEX ix_social_auth_flow_expiry ON social_auth_flows(expires_at);
