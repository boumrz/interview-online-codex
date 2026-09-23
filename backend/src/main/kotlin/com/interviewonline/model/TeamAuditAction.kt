package com.interviewonline.model

/**
 * The only actions production code may append to team audit storage.
 * LEGACY_UNCLASSIFIED is deliberately absent: it is a read projection only.
 */
enum class TeamAuditAction {
    TEAM_CREATE,
    INVITATION_CREATED,
    INVITATION_ACCEPTED,
    INVITATION_REVOKED,
    INVITATION_REISSUED,
    TEAM_RENAMED,
    MEMBER_ROLE_UPDATED,
    MEMBER_LEFT,
    MEMBER_SUSPENDED,
    MEMBER_RESUMED,
    MEMBER_REMOVED,
    TEAM_OWNERSHIP_TRANSFERRED,
    TEAM_INTERVIEW_OWNER_OFFER_CREATED,
    TEAM_INTERVIEW_OWNER_OFFER_ACCEPTED,
    TEAM_INTERVIEW_OWNER_OFFER_DECLINED,
    TEAM_INTERVIEW_ARCHIVED,
    TEAM_INTERVIEW_FROZEN,
    TEAM_INTERVIEW_RESUMED,
    TEAM_MERGED,
    ;

    val isInvitationAction: Boolean
        get() = this in INVITATION_ACTIONS

    companion object {
        private val byStorageValue = entries.associateBy(TeamAuditAction::name)
        private val INVITATION_ACTIONS = setOf(
            INVITATION_CREATED,
            INVITATION_ACCEPTED,
            INVITATION_REVOKED,
            INVITATION_REISSUED,
        )

        fun fromStorageValue(value: String): TeamAuditAction? = byStorageValue[value]
    }
}
