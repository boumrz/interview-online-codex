package com.interviewonline.features.socialauth

import com.interviewonline.model.User
import com.interviewonline.model.UserSession
import jakarta.persistence.*
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.data.repository.Repository
import java.time.Instant

@Entity
@Table(name = "social_auth_identities", uniqueConstraints = [UniqueConstraint(columnNames = ["provider", "subject"])])
class SocialAuthIdentity(
    @Id @GeneratedValue(strategy = GenerationType.UUID) var id: String? = null,
    @Column(nullable = false, length = 16) var provider: String = "",
    @Column(nullable = false) var subject: String = "",
    @ManyToOne(optional = false) @JoinColumn(name = "user_id") @OnDelete(action = OnDeleteAction.CASCADE) var user: User? = null,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "social_auth_flows")
class SocialAuthFlow(
    @Id var id: String = "",
    @Column(nullable = false, length = 16) var provider: String = "",
    @Column(name = "state_hash", nullable = false, length = 64, unique = true) var stateHash: String = "",
    @Column(name = "browser_proof_hash", nullable = false, length = 64) var browserProofHash: String = "",
    @Column(nullable = false, length = 16) var status: String = "CREATED",
    @Column(nullable = false, length = 16) var intent: String = "login",
    @Column(name = "initiating_user_id") var initiatingUserId: String? = null,
    @Column(name = "initiating_session_hash", length = 64) var initiatingSessionHash: String? = null,
    @Column var subject: String? = null,
    @Column(name = "display_name", length = 64) var displayName: String? = null,
    @Column(name = "return_requested", nullable = false) var returnRequested: Boolean = false,
    @Column(name = "return_room_id") var returnRoomId: String? = null,
    @Column(name = "return_team_id") var returnTeamId: String? = null,
    @Column(name = "return_invite_hash", length = 64) var returnInviteHash: String? = null,
    @Column(name = "completed_session_hash", length = 64) var completedSessionHash: String? = null,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
    @Column(name = "expires_at", nullable = false) var expiresAt: Instant = Instant.now(),
)

data class SocialAuthIdentityReference(val id: String, val userId: String)

interface SocialAuthIdentityRepository : JpaRepository<SocialAuthIdentity, String> {
    fun findByProviderAndSubject(provider: String, subject: String): SocialAuthIdentity?
    fun existsByUserIdAndProvider(userId: String, provider: String): Boolean

    @Query("""
        SELECT new com.interviewonline.features.socialauth.SocialAuthIdentityReference(identity.id, identity.user.id)
        FROM SocialAuthIdentity identity WHERE identity.provider = :provider AND identity.subject = :subject
    """)
    fun findReference(@Param("provider") provider: String, @Param("subject") subject: String): SocialAuthIdentityReference?

    @Query("SELECT DISTINCT identity.provider FROM SocialAuthIdentity identity WHERE identity.user.id = :userId")
    fun findLinkedProviders(@Param("userId") userId: String): Set<String>

    @Modifying
    @Query("DELETE FROM SocialAuthIdentity identity WHERE identity.user.id = :userId AND identity.provider = :provider")
    fun deleteProviderLinks(@Param("userId") userId: String, @Param("provider") provider: String): Int

    @Modifying
    @Query(value = """
        INSERT INTO social_auth_identities(id, provider, subject, user_id, created_at)
        VALUES (:id, :provider, :subject, :userId, :createdAt)
        ON CONFLICT (provider, subject) DO NOTHING
    """, nativeQuery = true)
    fun insertIfAbsent(@Param("id") id: String, @Param("provider") provider: String,
        @Param("subject") subject: String, @Param("userId") userId: String, @Param("createdAt") createdAt: Instant): Int

}

interface SocialAuthSessionGuardRepository : Repository<UserSession, String> {
    // Held after the user lock so deletion/revocation cannot overtake a profile mutation.
    @Query(value = "SELECT * FROM user_sessions WHERE token=:token FOR SHARE", nativeQuery = true)
    fun lockByToken(@Param("token") token: String): UserSession?
}

interface SocialAuthUserGuardRepository : Repository<User, String> {
    // Serialize social identity changes and existing-identity login with account deletion.
    // Keep the lock compatible with the FK KEY SHARE taken by other session inserts.
    @Query(value = "SELECT * FROM users WHERE id=:id FOR NO KEY UPDATE", nativeQuery = true)
    fun lockById(@Param("id") id: String): User?
}
interface SocialAuthFlowRepository : JpaRepository<SocialAuthFlow, String> {
    @Query(value = "SELECT * FROM social_auth_flows WHERE id=:id FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("id") id: String): SocialAuthFlow?
    @Modifying @Query("DELETE FROM SocialAuthFlow flow WHERE flow.expiresAt <= :now")
    fun deleteExpired(@Param("now") now: Instant): Int

    @Modifying
    @Query("""
        UPDATE SocialAuthFlow flow SET flow.status = 'FAILED', flow.subject = null, flow.displayName = null
        WHERE flow.intent = 'profile_link' AND flow.initiatingUserId = :userId AND flow.provider = :provider AND flow.status <> 'FAILED'
    """)
    fun invalidateProfileLinks(@Param("userId") userId: String, @Param("provider") provider: String): Int
}
