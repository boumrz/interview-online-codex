CREATE TABLE learning_progress (
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module VARCHAR(32) NOT NULL,
    state_json TEXT NOT NULL,
    PRIMARY KEY (user_id, module)
);
CREATE TABLE learning_commands (
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module VARCHAR(32) NOT NULL,
    command_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, module, command_id)
);
