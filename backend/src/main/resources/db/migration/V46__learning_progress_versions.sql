-- Preserve the v1 records and allow the prior release to read them on rollback.
CREATE TABLE learning_progress_versions (
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module VARCHAR(32) NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 2),
    state_json TEXT NOT NULL,
    PRIMARY KEY (user_id, module, version)
);

CREATE TABLE learning_command_versions (
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module VARCHAR(32) NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 2),
    command_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, module, version, command_id)
);
