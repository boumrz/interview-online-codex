ALTER TABLE team_interview_owner_offers
    DROP CONSTRAINT ck_team_interview_owner_offer_status;

ALTER TABLE team_interview_owner_offers
    ADD CONSTRAINT ck_team_interview_owner_offer_status
        CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'));
