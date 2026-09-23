-- Supports bounded retirement of terminal command receipts without scanning
-- the actor/idempotency namespace index. Expired receipts remain
-- authorization-first and non-replayable until an operational cleanup removes them.

CREATE INDEX idx_command_receipts_expires_at
    ON command_receipts (expires_at);
