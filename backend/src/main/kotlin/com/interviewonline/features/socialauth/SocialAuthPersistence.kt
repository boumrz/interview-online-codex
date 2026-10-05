package com.interviewonline.features.socialauth

import com.interviewonline.model.User
import jakarta.persistence.*
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
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
    @Column var subject: String? = null,
    @Column(name = "display_name", length = 64) var displayName: String? = null,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
    @Column(name = "expires_at", nullable = false) var expiresAt: Instant = Instant.now(),
)

interface SocialAuthIdentityRepository : JpaRepository<SocialAuthIdentity, String> {
    fun findByProviderAndSubject(provider: String, subject: String): SocialAuthIdentity?
}
interface SocialAuthFlowRepository : JpaRepository<SocialAuthFlow, String> {
    @Query(value = "SELECT * FROM social_auth_flows WHERE id=:id FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("id") id: String): SocialAuthFlow?
    @Modifying @Query("DELETE FROM SocialAuthFlow flow WHERE flow.expiresAt <= :now")
    fun deleteExpired(@Param("now") now: Instant): Int
}
