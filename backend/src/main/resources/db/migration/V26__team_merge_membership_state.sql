ALTER TABLE team_memberships DROP CONSTRAINT ck_team_memberships_state;
ALTER TABLE team_memberships ADD CONSTRAINT ck_team_memberships_state
    CHECK (state IN ('ACTIVE', 'SUSPENDED', 'LEFT', 'REMOVED', 'MERGED'));
