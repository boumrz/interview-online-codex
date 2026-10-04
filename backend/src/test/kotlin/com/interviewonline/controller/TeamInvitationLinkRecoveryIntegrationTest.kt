package com.interviewonline.controller

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.InterviewOnlineApplication
import com.interviewonline.service.InvitationExpiryCleanupCoordinator
import com.interviewonline.service.TeamInvitationExpiryCleanup
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.WebApplicationType
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.ApplicationContext
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.Timestamp
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

/**
 * RED contract for issuer-only invitation-link recovery.  It deliberately
 * exercises HTTP contracts instead of service internals.  The current server
 * has no list/reveal endpoints and still returns a raw URL from generic
 * mutations, so these assertions are expected to fail until tasks 2.1-2.3.
 */
@SpringBootTest(
    properties = [
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ],
)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamInvitationLinkRecoveryIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
    @Autowired private val dataSource: DataSource,
    @Autowired private val applicationContext: ApplicationContext,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("invitation_recovery")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `team has one rotating invitation link accepted by multiple members`() {
        val owner = account("shared-link-owner")
        val firstMember = account("shared-link-first")
        val secondMember = account("shared-link-second")
        val team = team(owner, "Shared team link")

        val first = createAndReveal(owner, team.id)
        val second = createAndReveal(owner, team.id)
        assertEquals(first.id, second.id, "issuing again rotates the same team invitation")
        assertNotEquals(first.url, second.url, "the old bearer URL is invalidated")
        assertStatusAndCode(preview(first.token), 410, "INVITATION_UNAVAILABLE")
        assertEquals(1, body(list(owner, team.id)).path("items").size(), "only one link is shown")

        assertStatus(accept(firstMember, second.token), 200, "first member joins")
        assertStatus(accept(secondMember, second.token), 200, "second member joins through the same link")
        assertStatus(preview(second.token), 200, "the shared link remains usable after joins")
        assertEquals("PENDING", invitationState(second.id), "acceptance does not consume the team link")
    }

    @Test
    fun `issuer explicitly recovers the exact pending URL while generic metadata stays URL free`() {
        postgres.verifyPostgres16()
        val owner = account("recovery-owner")
        val otherManager = account("recovery-manager")
        val team = team(owner, "Recovery contract")
        seedMembership(team.id, otherManager.id, role = "ADMIN")

        val created = create(owner, team.id)
        assertStatus(created, 201, "create must succeed before recovery")
        val createdInvitation = invitation(created)
        assertExactInvitationMetadata(createdInvitation)
        assertFalse(createdInvitation.has("url"), "generic create must never expose a bearer URL")
        val invitationId = createdInvitation.path("id").asText()

        val revealed = captureNoSecretLogs { reveal(owner, team.id, invitationId) }
        assertStatus(revealed.result, 200, "creator must explicitly recover a pending link")
        assertProtectedNoStore(revealed.result)
        assertEquals("no-cache", revealed.result.response.getHeader("Pragma"))
        val url = body(revealed.result).path("url").asText()
        assertTrue(url.startsWith("/join/team#token="), "only explicit reveal may return a fragment URL")
        val token = tokenFromUrl(url)
        revealed.assertNoToken(token)

        val afterReload = list(owner, team.id)
        assertStatus(afterReload, 200, "reload restores metadata but not a URL")
        assertProtectedNoStore(afterReload)
        val listed = body(afterReload).path("items")
        assertTrue(listed.isArray && listed.size() == 1, "manager list must include the pending link")
        val metadata = listed[0]
        assertExactInvitationMetadata(metadata)
        assertEquals("RECOVERABLE", metadata.path("linkRecoverability").asText())
        assertTrue(metadata.path("canReveal").asBoolean())
        assertFalse(body(afterReload).toString().contains(token), "metadata list must never leak the URL token")

        val afterCopyOrReloadReveal = reveal(owner, team.id, invitationId)
        assertStatus(afterCopyOrReloadReveal, 200, "explicit recovery after copy or reload remains available")
        assertEquals(url, body(afterCopyOrReloadReveal).path("url").asText(), "reveal must recover the exact same URL")

        val managerReveal = reveal(otherManager, team.id, invitationId)
        assertStatus(managerReveal, 200, "another manager can copy the shared team link")
        assertProtectedNoStore(managerReveal)
        assertEquals(url, body(managerReveal).path("url").asText())
    }

    @Test
    fun `invitation list enforces manager authorization and projects creator scoped recoverability`() {
        val owner = account("list-owner")
        val creator = account("list-creator")
        val foreignManager = account("list-manager")
        val member = account("list-member")
        val outsider = account("list-outsider")
        val team = team(owner, "List authority")
        seedMembership(team.id, creator.id, role = "ADMIN")
        seedMembership(team.id, foreignManager.id, role = "ADMIN")
        seedMembership(team.id, member.id, role = "MEMBER")
        val created = create(creator, team.id)
        assertStatus(created, 201, "manager fixture must create a pending invitation")
        val invitationId = invitation(created).path("id").asText()

        val creatorList = list(creator, team.id)
        assertStatus(creatorList, 200, "creator manager must list invitation metadata")
        assertProtectedNoStore(creatorList)
        val creatorMetadata = metadata(creatorList, invitationId)
        assertExactInvitationMetadata(creatorMetadata)
        assertEquals("PENDING", creatorMetadata.path("state").asText())
        assertTrue(creatorMetadata.path("canReveal").asBoolean())
        assertEquals("RECOVERABLE", creatorMetadata.path("linkRecoverability").asText())

        listOf(owner, foreignManager).forEach { otherManager ->
            val managerList = list(otherManager, team.id)
            assertStatus(managerList, 200, "other active managers can see safe lifecycle metadata")
            assertProtectedNoStore(managerList)
            val managerMetadata = metadata(managerList, invitationId)
            assertExactInvitationMetadata(managerMetadata)
            assertTrue(managerMetadata.path("canReveal").asBoolean(), "managers can reveal the team link")
            assertEquals("RECOVERABLE", managerMetadata.path("linkRecoverability").asText())
        }

        val unauthenticated = mockMvc.get("/api/teams/${team.id}/invitations").andReturn()
        val memberDenied = list(member, team.id)
        val foreignDenied = list(outsider, team.id)
        listOf(
            Triple(unauthenticated, 401, "UNAUTHORIZED"),
            Triple(memberDenied, 403, "INVITATION_MANAGEMENT_FORBIDDEN"),
            Triple(foreignDenied, 404, "TEAM_NOT_FOUND"),
        ).forEach { (denied, status, code) -> assertExactInvitationDenial(denied, status, code) }
    }

    @Test
    fun `list shows the single safe lifecycle state and terminal links cannot be revealed`() {
        val owner = account("lifecycle-owner")
        val recipient = account("lifecycle-recipient")
        val team = team(owner, "Lifecycle contract")
        val invitation = createAndReveal(owner, team.id)

        assertStatus(accept(recipient, invitation.token), 200, "a member joins")
        assertEquals("PENDING", invitationState(invitation.id), "accept does not consume the link")
        assertStatus(reveal(owner, team.id, invitation.id), 200, "the link remains recoverable")
        val active = list(owner, team.id)
        assertEquals(1, body(active).path("items").size())
        assertEquals("PENDING", metadata(active, invitation.id).path("state").asText())
        assertEquals(invitationMetadataFields, metadata(active, invitation.id).fieldNames().asSequence().toSet())

        assertStatus(revoke(owner, team.id, invitation.id, 0), 200, "revoke succeeds")
        assertEnvelopeCleared(invitation.id, "revoke clears the bearer recovery pair")
        assertStatusAndCode(reveal(owner, team.id, invitation.id), 410, "INVITATION_LINK_UNAVAILABLE")
        val revoked = list(owner, team.id)
        assertEquals("REVOKED", metadata(revoked, invitation.id).path("state").asText())

        val rotated = createAndReveal(owner, team.id)
        assertEquals(invitation.id, rotated.id, "the team reuses its invitation record")
        jdbcTemplate.update("UPDATE team_invitations SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), invitation.id)
        val expired = list(owner, team.id)
        assertEquals("EXPIRED", metadata(expired, invitation.id).path("state").asText())
        assertStatusAndCode(reveal(owner, team.id, invitation.id), 410, "INVITATION_LINK_UNAVAILABLE")
        assertEnvelopeCleared(invitation.id, "expired link has no recovery material")
    }

    @Test
    fun `second create and explicit reissue rotate one team link`() {
        val owner = account("independent-owner")
        val team = team(owner, "One team link")
        val first = createAndReveal(owner, team.id)
        val second = createAndReveal(owner, team.id)
        assertEquals(first.id, second.id)
        assertNotEquals(first.url, second.url)
        assertStatusAndCode(preview(first.token), 410, "INVITATION_UNAVAILABLE")

        val reissued = reissue(owner, team.id, second.id, 1)
        assertStatus(reissued, 201, "explicit reissue succeeds")
        assertEquals(second.id, invitation(reissued).path("id").asText())
        val current = reveal(owner, team.id, second.id)
        assertStatus(current, 200, "rotated link remains revealable")
        assertNotEquals(second.url, body(current).path("url").asText())
        assertStatusAndCode(preview(second.token), 410, "INVITATION_UNAVAILABLE")
        assertEquals(1L, invitationCount(team.id), "rotation does not add records")
    }

    @Test
    fun `invitation list defaults pages safely and hides metadata from unavailable callers`() {
        val owner = account("list-pages-owner")
        val member = account("list-pages-member")
        val foreignManager = account("list-pages-foreign")
        val team = team(owner, "Invitation pages")
        seedMembership(team.id, member.id, role = "MEMBER")
        repeat(27) { index ->
            val id = seedLegacyPending(team.id, owner.id)
            jdbcTemplate.update(
                "UPDATE team_invitations SET created_at=? WHERE id=?",
                Timestamp.from(Instant.now().minusSeconds(index.toLong())),
                id,
            )
        }

        val first = list(owner, team.id)
        assertStatus(first, 200, "default invitation list page must be available")
        assertProtectedNoStore(first)
        assertEquals(1, body(first).path("items").size(), "only the current team link is listed")
        assertEquals(0, body(first).path("page").asInt())
        assertEquals(25, body(first).path("size").asInt())
        assertEquals(1, body(first).path("totalElements").asInt())
        assertEquals(1, body(first).path("totalPages").asInt())

        val second = list(owner, team.id, page = 1, size = 25)
        assertStatus(second, 200, "second invitation page must be available")
        assertProtectedNoStore(second)
        assertEquals(0, body(second).path("items").size())
        assertEquals(1, body(second).path("page").asInt())
        assertEquals(1, body(second).path("totalElements").asInt())
        assertEquals(1, body(second).path("totalPages").asInt())

        val unauthenticated = mockMvc.get("/api/teams/${team.id}/invitations").andReturn()
        val memberDenied = list(member, team.id)
        val foreignDenied = list(foreignManager, team.id)
        val unknownTeam = list(owner, UUID.randomUUID().toString())
        listOf(
            Triple(unauthenticated, 401, "UNAUTHORIZED"),
            Triple(memberDenied, 403, "INVITATION_MANAGEMENT_FORBIDDEN"),
            Triple(foreignDenied, 404, "TEAM_NOT_FOUND"),
            Triple(unknownTeam, 404, "TEAM_NOT_FOUND"),
        ).forEach { (denied, status, code) ->
            assertExactInvitationDenial(denied, status, code)
            assertFalse(denied.response.contentAsString.contains(team.id), "unavailable list response cannot disclose a team identifier")
        }
        assertEquals(
            foreignDenied.response.contentAsString,
            unknownTeam.response.contentAsString,
            "foreign and unknown teams use indistinguishable metadata-free bodies",
        )
    }

    @Test
    fun `member cannot create reissue or revoke while state and no-store protections remain intact`() {
        val owner = account("mutation-owner")
        val member = account("mutation-member")
        val team = team(owner, "Mutation authority")
        seedMembership(team.id, member.id, role = "MEMBER")
        val created = create(owner, team.id)
        assertStatus(created, 201, "manager create fixture must succeed")
        assertProtectedNoStore(created)
        val original = invitation(created)
        val invitationId = original.path("id").asText()
        val before = invitationStateAndRevision(invitationId)

        val deniedCreate = create(member, team.id)
        val deniedReissue = reissue(member, team.id, invitationId, before.revision)
        val deniedRevoke = revoke(member, team.id, invitationId, before.revision)
        listOf(deniedCreate, deniedReissue, deniedRevoke).forEach { denied ->
            assertExactInvitationDenial(denied, 403, "INVITATION_MANAGEMENT_FORBIDDEN")
        }
        assertEquals(before, invitationStateAndRevision(invitationId), "denied member mutations must not alter invitation state")

        val managerRevoke = revoke(owner, team.id, invitationId, before.revision)
        assertStatus(managerRevoke, 200, "manager may mutate the same invitation")
        assertProtectedNoStore(managerRevoke)
        assertEquals("REVOKED", invitationState(invitationId))
    }

    @Test
    fun `recovery migration stores envelope and key as an all-or-none nullable legacy pair`() {
        val owner = account("migration-owner")
        val team = team(owner, "Recovery migration")
        val recoveryColumns = jdbcTemplate.queryForList(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='team_invitations'
              AND column_name IN ('recoverable_token_envelope', 'recovery_key_version')
            """.trimIndent(),
            String::class.java,
        ).toSet()
        assertEquals(
            setOf("recoverable_token_envelope", "recovery_key_version"),
            recoveryColumns,
            "V15 must add both recovery columns before the contract is exercised",
        )

        val legacyId = seedLegacyPending(team.id, owner.id)
        val legacyPair = jdbcTemplate.queryForMap(
            "SELECT recoverable_token_envelope, recovery_key_version FROM team_invitations WHERE id=?",
            legacyId,
        )
        assertNull(legacyPair["recoverable_token_envelope"], "legacy raw-token rows may retain the all-null pair")
        assertNull(legacyPair["recovery_key_version"], "legacy raw-token rows may retain the all-null pair")

        assertThrows(DataIntegrityViolationException::class.java, {
            insertRecoveryShape(team.id, owner.id, envelope = "v1:opaque", keyVersion = null)
        }, "envelope without key version must be rejected")
        assertThrows(DataIntegrityViolationException::class.java, {
            insertRecoveryShape(team.id, owner.id, envelope = null, keyVersion = "integration-v1")
        }, "key version without envelope must be rejected")
        assertThrows(DataIntegrityViolationException::class.java, {
            insertRecoveryShape(team.id, owner.id, envelope = null, keyVersion = null, state = "EXPIRED")
        }, "EXPIRED is an effective state and is not persisted")
    }

    @Test
    fun `second issue invalidates the previous link and the new link stays reusable`() {
        val owner = account("multiple-owner")
        val recipient = account("multiple-recipient")
        val anotherRecipient = account("multiple-second")
        val team = team(owner, "One reusable invitation")
        val first = createAndReveal(owner, team.id)
        val second = createAndReveal(owner, team.id)

        assertEquals(first.id, second.id)
        assertStatusAndCode(preview(first.token), 410, "INVITATION_UNAVAILABLE")
        assertStatus(accept(recipient, second.token), 200, "recipient can join")
        assertStatus(accept(anotherRecipient, second.token), 200, "another recipient can join")
        assertEquals(1L, activeMembershipCount(team.id, recipient.id))
        assertEquals(1L, activeMembershipCount(team.id, anotherRecipient.id))
        assertStatus(reveal(owner, team.id, second.id), 200, "the shared link remains active")
    }

    @Test
    fun `authorized manager who manually reissues becomes the only replacement revealer`() {
        val owner = account("reissue-owner")
        val reissuingAdmin = account("reissue-admin")
        val team = team(owner, "Replacement issuer")
        seedMembership(team.id, reissuingAdmin.id, role = "ADMIN")
        val original = createAndReveal(owner, team.id)

        val reissued = reissue(reissuingAdmin, team.id, original.id, 0)
        assertStatus(reissued, 201, "another authorized manager may manually reissue")
        val replacementId = invitation(reissued).path("id").asText()
        assertExactInvitationMetadata(invitation(reissued))
        val replacementReveal = reveal(reissuingAdmin, team.id, replacementId)
        assertStatus(replacementReveal, 200, "reissuing manager becomes replacement creator")
        val ownerReveal = reveal(owner, team.id, replacementId)
        assertStatus(ownerReveal, 200, "owner can reveal the team link after admin rotation")
        assertProtectedNoStore(ownerReveal)
        assertFalse(ownerReveal.response.contentAsString.contains(original.token))
    }

    @Test
    fun `legacy raw link remains previewable and accepts its recipient exactly once`() {
        val owner = account("legacy-owner")
        val recipient = account("legacy-recipient")
        val team = team(owner, "Legacy redemption")
        val legacy = seedLegacyRawToken(team.id, owner.id)

        val preview = captureNoSecretLogs { preview(legacy.token) }
        assertStatus(preview.result, 200, "recipient can still preview a legacy raw link")
        assertProtectedNoStore(preview.result)
        assertFalse(preview.result.response.contentAsString.contains(legacy.token))
        preview.assertNoToken(legacy.token)

        val firstAccept = captureNoSecretLogs { accept(recipient, legacy.token) }
        assertStatus(firstAccept.result, 200, "legacy recipient can accept known link")
        firstAccept.assertNoToken(legacy.token)
        val replay = accept(recipient, legacy.token)
        assertStatus(replay, 200, "same recipient receives a safe terminal replay")
        assertEquals(1L, activeMembershipCount(team.id, recipient.id), "legacy link creates one ACTIVE membership")

        val ownerList = list(owner, team.id)
        assertStatus(ownerList, 200, "legacy acceptance remains visible as safe lifecycle metadata")
        val metadata = metadata(ownerList, legacy.id)
        assertEquals("PENDING", metadata.path("state").asText())
        assertFalse(metadata.path("canReveal").asBoolean())
        assertEquals("UNRECOVERABLE_LEGACY", metadata.path("linkRecoverability").asText())
    }

    @Test
    fun `reveal response normalizes authority terminal corruption and busy outcomes`() {
        val owner = account("reveal-owner")
        val member = account("reveal-member")
        val outsider = account("reveal-outsider")
        val team = team(owner, "Reveal denial matrix")
        seedMembership(team.id, member.id, role = "MEMBER")
        val invitation = createAndReveal(owner, team.id)

        val unauthenticated = captureNoSecretLogs { mockMvc.get("/api/teams/${team.id}/invitations/${invitation.id}/link").andReturn() }
        assertStatusAndCode(unauthenticated.result, 401, "UNAUTHORIZED")
        assertProtectedNoStore(unauthenticated.result)

        val memberDenied = captureNoSecretLogs { reveal(member, team.id, invitation.id) }
        assertStatusAndCode(memberDenied.result, 403, "INVITATION_MANAGEMENT_FORBIDDEN")
        assertProtectedNoStore(memberDenied.result)

        val foreignTeam = captureNoSecretLogs { reveal(outsider, team.id, invitation.id) }
        assertStatusAndCode(foreignTeam.result, 404, "TEAM_NOT_FOUND")
        assertProtectedNoStore(foreignTeam.result)

        val missing = captureNoSecretLogs { reveal(owner, team.id, UUID.randomUUID().toString()) }
        assertStatusAndCode(missing.result, 410, "INVITATION_LINK_UNAVAILABLE")
        assertProtectedNoStore(missing.result)

        jdbcTemplate.update("UPDATE team_invitations SET recovery_key_version=? WHERE id=?", "unknown-key-version", invitation.id)
        val unknownKey = captureNoSecretLogs { reveal(owner, team.id, invitation.id) }
        assertStatusAndCode(unknownKey.result, 503, "INVITATION_LINK_RECOVERY_UNAVAILABLE")
        assertEquals("5", unknownKey.result.response.getHeader("Retry-After"))
        assertProtectedNoStore(unknownKey.result)
        listOf(unauthenticated, memberDenied, foreignTeam, missing, unknownKey).forEach { captured ->
            assertFalse(captured.result.response.contentAsString.contains(invitation.token), "every reveal denial must omit the token")
            captured.assertNoToken(invitation.token)
        }
    }

    @Test
    fun `corrupt ciphertext and hash mismatch fail closed without exposing the link`() {
        val owner = account("corrupt-owner")
        val team = team(owner, "Corrupt recovery")

        val corrupt = createAndReveal(owner, team.id)
        jdbcTemplate.update("UPDATE team_invitations SET recoverable_token_envelope=? WHERE id=?", "not-a-valid-envelope", corrupt.id)
        val corruptResult = captureNoSecretLogs { reveal(owner, team.id, corrupt.id) }
        assertStatusAndCode(corruptResult.result, 503, "INVITATION_LINK_RECOVERY_UNAVAILABLE")
        assertEquals("5", corruptResult.result.response.getHeader("Retry-After"))
        assertProtectedNoStore(corruptResult.result)
        assertFalse(corruptResult.result.response.contentAsString.contains(corrupt.token))
        corruptResult.assertNoToken(corrupt.token)

        val mismatched = createAndReveal(owner, team.id)
        jdbcTemplate.update("UPDATE team_invitations SET token_hash=? WHERE id=?", sha256(newToken()), mismatched.id)
        val mismatchResult = captureNoSecretLogs { reveal(owner, team.id, mismatched.id) }
        assertStatusAndCode(mismatchResult.result, 503, "INVITATION_LINK_RECOVERY_UNAVAILABLE")
        assertEquals("5", mismatchResult.result.response.getHeader("Retry-After"))
        assertProtectedNoStore(mismatchResult.result)
        assertFalse(mismatchResult.result.response.contentAsString.contains(mismatched.token))
        mismatchResult.assertNoToken(mismatched.token)
    }

    @Test
    fun `recovery envelope remains bound to team and creator`() {
        val owner = account("aado")
        val otherOwner = account("aadt")
        val admin = account("aadm")
        val firstTeam = team(owner, "AAD first team")
        val secondTeam = team(otherOwner, "AAD second team")
        seedMembership(firstTeam.id, admin.id, role = "ADMIN")

        fun assertTransplantRejected(
            source: InvitationRef,
            target: InvitationRef,
            targetActor: HrTestAccount,
            targetTeamId: String,
            marker: String,
        ) {
            transplantRecoveryMaterial(source.id, target.id)
            val rejected = captureNoSecretLogs { reveal(targetActor, targetTeamId, target.id) }
            assertStatusAndCode(rejected.result, 503, "INVITATION_LINK_RECOVERY_UNAVAILABLE")
            assertEquals("5", rejected.result.response.getHeader("Retry-After"))
            assertProtectedNoStore(rejected.result)
            assertFalse(rejected.result.response.contentAsString.contains(source.token), "$marker must not return the transplanted bearer")
            rejected.assertNoToken(source.token)
        }

        assertTransplantRejected(
            createAndReveal(owner, firstTeam.id),
            createAndReveal(otherOwner, secondTeam.id),
            otherOwner,
            secondTeam.id,
            "different team",
        )
        val creatorBound = createAndReveal(owner, firstTeam.id)
        jdbcTemplate.update("UPDATE team_invitations SET creator_user_id=? WHERE id=?", admin.id, creatorBound.id)
        val wrongCreator = reveal(admin, firstTeam.id, creatorBound.id)
        assertStatusAndCode(wrongCreator, 503, "INVITATION_LINK_RECOVERY_UNAVAILABLE")
        assertFalse(wrongCreator.response.contentAsString.contains(creatorBound.token))
    }

    @Test
    fun `former invitation creator receives the normalized unavailable team outcome`() {
        val owner = account("lefto")
        val formerAdmin = account("lefta")
        val team = team(owner, "Former creator")
        seedMembership(team.id, formerAdmin.id, role = "ADMIN")
        val invitation = createAndReveal(formerAdmin, team.id)
        jdbcTemplate.update("UPDATE team_memberships SET state='LEFT' WHERE team_id=? AND user_id=?", team.id, formerAdmin.id)

        assertStatusAndCode(preview(invitation.token), 410, "INVITATION_UNAVAILABLE")
        assertStatusAndCode(accept(account("left-recipient"), invitation.token), 410, "INVITATION_UNAVAILABLE")

        val denied = captureNoSecretLogs { reveal(formerAdmin, team.id, invitation.id) }

        assertExactInvitationDenial(denied.result, 404, "TEAM_NOT_FOUND")
        assertFalse(denied.result.response.contentAsString.contains(invitation.token))
        denied.assertNoToken(invitation.token)
    }

    @Test
    fun `team lock barrier makes expiry cleanup reveal accept revoke and reissue retry safely`() {
        val owner = account("busy-owner")
        val recipient = account("busy-recipient")
        val team = team(owner, "Busy invitation")
        val invitation = createAndReveal(owner, team.id)
        jdbcTemplate.update("UPDATE team_invitations SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), invitation.id)
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val lockExecutor = Executors.newSingleThreadExecutor()
        val operationExecutor = Executors.newFixedThreadPool(5)
        try {
            val holder = lockExecutor.submit {
                dataSource.connection.use { connection ->
                    connection.autoCommit = false
                    connection.prepareStatement("SELECT id FROM teams WHERE id=? FOR UPDATE").use { statement ->
                        statement.setString(1, team.id)
                        statement.executeQuery().use { result -> assertTrue(result.next(), "lock fixture must find the team") }
                    }
                    locked.countDown()
                    release.await(15, TimeUnit.SECONDS)
                    connection.rollback()
                }
            }
            assertTrue(locked.await(5, TimeUnit.SECONDS), "test fixture acquired team lock")
            val operations = listOf<Pair<String, () -> MvcResult>>(
                "expiry-cleanup" to { list(owner, team.id) },
                "reveal" to { reveal(owner, team.id, invitation.id) },
                "accept" to { accept(recipient, invitation.token) },
                "revoke" to { revoke(owner, team.id, invitation.id, 0) },
                "reissue" to { reissue(owner, team.id, invitation.id, 0) },
            )
            val outcomes = operations.map { (name, request) ->
                operationExecutor.submit(Callable { name to request() })
            }.map { it.get(12, TimeUnit.SECONDS) }
            outcomes.forEach { (operation, busy) ->
                assertStatusAndCode(busy, 503, "INVITATION_BUSY")
                assertEquals("5", busy.response.getHeader("Retry-After"), "$operation tells caller when retry is safe")
                assertProtectedNoStore(busy)
                assertFalse(busy.response.contentAsString.contains(invitation.token), "$operation must not disclose an expired bearer")
            }
            release.countDown()
            holder.get(20, TimeUnit.SECONDS)
        } finally {
            release.countDown()
            lockExecutor.shutdownNow()
            operationExecutor.shutdownNow()
        }
    }

    @Test
    fun `test barrier controls cleanup and reveal race to an expired atomic terminal`() {
        val owner = account("cleanup-race-owner")
        val team = team(owner, "Cleanup reveal race")
        val invitation = createAndReveal(owner, team.id)
        jdbcTemplate.update("UPDATE team_invitations SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), invitation.id)

        val outcomes = releasedLifecycleRace(
            "cleanup" to { list(owner, team.id) },
            "reveal" to { reveal(owner, team.id, invitation.id) },
        )
        assertTrue(outcomes.getValue("reveal").response.status != 200, "an expiry race must never return a stale bearer URL")
        outcomes.values.forEach { assertProtectedNoStore(it) }

        val terminal = list(owner, team.id)
        assertStatus(terminal, 200, "a completed cleanup race has a readable terminal projection")
        assertEquals("EXPIRED", metadata(terminal, invitation.id).path("state").asText())
        assertEnvelopeCleared(invitation.id, "cleanup winner clears the full recovery pair atomically")
        assertEquals("PENDING", invitationState(invitation.id), "cleanup preserves the persisted state constraint")
        val staleReveal = reveal(owner, team.id, invitation.id)
        assertStatusAndCode(staleReveal, 410, "INVITATION_LINK_UNAVAILABLE")
        assertProtectedNoStore(staleReveal)
    }

    @Test
    fun `accept and reissue serialize while the old bearer becomes unusable`() {
        val owner = account("ar-owner")
        val recipient = account("ar-recipient")
        val team = team(owner, "Accept reissue race")
        val invitation = createAndReveal(owner, team.id)

        val outcomes = releasedLifecycleRace(
            "accept" to { accept(recipient, invitation.token) },
            "reissue" to { reissue(owner, team.id, invitation.id, 0) },
        )
        assertStatus(outcomes.getValue("reissue"), 201, "rotation succeeds under team lock")
        assertTrue(outcomes.getValue("accept").response.status in setOf(200, 410), "accept commits before rotation or sees the revoked bearer")
        assertEquals(if (outcomes.getValue("accept").response.status == 200) 1L else 0L,
            activeMembershipCount(team.id, recipient.id))
        assertEquals(1L, invitationCount(team.id), "rotation does not add a row")
        assertStatusAndCode(preview(invitation.token), 410, "INVITATION_UNAVAILABLE")
        assertStatus(reveal(owner, team.id, invitation.id), 200, "new link remains recoverable")
    }

    @Test
    fun `accept and revoke serialize while a completed join remains valid`() {
        val owner = account("av-owner")
        val recipient = account("av-recipient")
        val team = team(owner, "Accept revoke race")
        val invitation = createAndReveal(owner, team.id)

        val outcomes = releasedLifecycleRace(
            "accept" to { accept(recipient, invitation.token) },
            "revoke" to { revoke(owner, team.id, invitation.id, 0) },
        )
        assertStatus(outcomes.getValue("revoke"), 200, "revoke succeeds under team lock")
        assertTrue(outcomes.getValue("accept").response.status in setOf(200, 410))
        assertEquals(if (outcomes.getValue("accept").response.status == 200) 1L else 0L,
            activeMembershipCount(team.id, recipient.id))
        assertEquals("REVOKED", invitationState(invitation.id))
        assertStatusAndCode(preview(invitation.token), 410, "INVITATION_UNAVAILABLE")
    }

    @Test
    fun `test barrier controls reissue and revoke with the permitted terminal winner branches`() {
        val owner = account("rv-owner")
        val team = team(owner, "Reissue revoke race")
        val invitation = createAndReveal(owner, team.id)

        val outcomes = releasedLifecycleRace(
            "reissue" to { reissue(owner, team.id, invitation.id, 0) },
            "revoke" to { revoke(owner, team.id, invitation.id, 0) },
        )
        assertOneLifecycleWinner(outcomes, "reissue/revoke")
        when (lifecycleWinner(outcomes)) {
            "reissue" -> {
                assertEquals("PENDING", invitationState(invitation.id))
                assertStatus(reveal(owner, team.id, invitation.id), 200, "rotated link is available")
            }
            "revoke" -> {
                assertEquals("REVOKED", invitationState(invitation.id))
                assertStatusAndCode(reveal(owner, team.id, invitation.id), 410, "INVITATION_LINK_UNAVAILABLE")
            }
            else -> error("reissue/revoke winner must be a participating operation")
        }
        assertEquals(1L, invitationCount(team.id))
        assertStatusAndCode(preview(invitation.token), 410, "INVITATION_UNAVAILABLE")
    }

    @Test
    fun `scheduled cleanup skips already-cleared expired rows and cleans the next recoverable link`() {
        val owner = account("clnp")
        val team = team(owner, "Cleanup progression")
        val earliestExpiry = Instant.now().minusSeconds(1_000)
        repeat(100) { index ->
            insertRecoveryShape(
                team.id,
                owner.id,
                invitationId = "already-cleared-$index-${UUID.randomUUID()}",
                envelope = null,
                keyVersion = null,
                expiresAt = earliestExpiry.plusSeconds(index.toLong()),
            )
        }
        val recoverableAfterBatch = UUID.randomUUID().toString()
        insertRecoveryShape(
            team.id,
            owner.id,
            invitationId = recoverableAfterBatch,
            envelope = "v1:after-cleared-batch",
            keyVersion = "integration-v1",
            expiresAt = Instant.now().minusSeconds(1),
        )
        val inactiveOwner = account("clni")
        val inactiveTeam = team(inactiveOwner, "Inactive cleanup")
        val inactiveTeamExpired = UUID.randomUUID().toString()
        insertRecoveryShape(
            inactiveTeam.id,
            inactiveOwner.id,
            invitationId = inactiveTeamExpired,
            envelope = "v1:inactive-team",
            keyVersion = "integration-v1",
            expiresAt = Instant.now().minusSeconds(1),
        )
        jdbcTemplate.update("UPDATE teams SET state='MERGED' WHERE id=?", inactiveTeam.id)

        applicationContext.getBean(InvitationExpiryCleanupCoordinator::class.java).cleanupCandidates(100)

        assertEnvelopeCleared(
            recoverableAfterBatch,
            "the bounded scheduler must progress beyond earlier PENDING rows whose recovery pair is already cleared",
        )
        assertEnvelopeCleared(
            inactiveTeamExpired,
            "cleanup must clear an expired recovery pair after its team becomes inactive without granting team access",
        )
    }

    @Test
    fun `scheduled cleanup processes at most one hundred recoverable candidates per pass`() {
        val owner = account("batc")
        val team = team(owner, "Cleanup batch bound")
        val invitationIds = (0 until 101).map { index ->
            UUID.randomUUID().toString().also { invitationId ->
                insertRecoveryShape(
                    team.id,
                    owner.id,
                    invitationId = invitationId,
                    envelope = "v1:batch-$index",
                    keyVersion = "integration-v1",
                    expiresAt = Instant.now().minusSeconds(120),
                )
            }
        }
        val coordinator = applicationContext.getBean(InvitationExpiryCleanupCoordinator::class.java)

        assertEquals(100, coordinator.cleanupCandidates(100), "one cleanup pass clears no more than its candidate limit")
        assertEquals(1L, recoveryPairCount(team.id), "one recoverable candidate remains for the next cleanup pass")
        assertTrue(coordinator.cleanupCandidates(100) >= 1, "the next pass reaches the remaining candidate")
        assertEquals(0L, recoveryPairCount(team.id))
        assertEquals(101, invitationIds.size, "the fixture must exercise the limit boundary")
    }

    @Test
    fun `scheduled cleanup racing reveal leaves only the expired terminal projection`() {
        val owner = account("race")
        val team = team(owner, "Scheduled cleanup race")
        val invitation = createAndReveal(owner, team.id)
        jdbcTemplate.update("UPDATE team_invitations SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), invitation.id)
        val cleanup = applicationContext.getBean(TeamInvitationExpiryCleanup::class.java)
        val barrier = lifecycleTestBarrier(applicationContext)
        val executor = Executors.newFixedThreadPool(2)
        barrier.arm()
        try {
            val cleanupResult = executor.submit(Callable { cleanup.cleanupOneCandidateForH2Test() })
            assertTrue(barrier.awaitArrival(), "scheduled cleanup must hold the team lock before reveal proceeds")
            val revealResult = executor.submit(Callable { reveal(owner, team.id, invitation.id) })
            barrier.releaseOne()
            assertTrue(cleanupResult.get(15, TimeUnit.SECONDS), "scheduled cleanup clears the expired recovery pair")
            val reveal = revealResult.get(15, TimeUnit.SECONDS)
            assertStatusAndCode(reveal, 410, "INVITATION_LINK_UNAVAILABLE")
            assertProtectedNoStore(reveal)
            assertFalse(reveal.response.contentAsString.contains(invitation.token))
            assertEnvelopeCleared(invitation.id, "scheduled cleanup clears the full recovery pair atomically")
            assertEquals("PENDING", invitationState(invitation.id), "scheduled cleanup preserves the persisted invitation state set")
            val listed = list(owner, team.id)
            assertEquals("EXPIRED", metadata(listed, invitation.id).path("state").asText())
        } finally {
            barrier.reset()
            executor.shutdownNow()
        }
    }

    @Test
    fun `test-profile H2 scheduler seam cleans successive candidates and rechecks a later expired candidate`() {
        val h2Application = startH2RecoveryApplication(profile = "test", webApplicationType = WebApplicationType.SERVLET)
        try {
            assertTrue(h2Application.environment.activeProfiles.contains("test"), "H2 cleanup harness must explicitly activate the test profile")
            val cleanupClass = resolveH2SingleCandidateCleanupClass()
            val barrier = lifecycleTestBarrier(h2Application)
            assertNoHttpExposure(h2Application, cleanupClass, barrier.type)
            val h2Jdbc = h2Application.getBean(JdbcTemplate::class.java)
            val ownerId = UUID.randomUUID().toString()
            val teamId = UUID.randomUUID().toString()
            val firstExpiredId = UUID.randomUUID().toString()
            val secondExpiredId = UUID.randomUUID().toString()
            val recheckedCandidateId = UUID.randomUUID().toString()
            h2Jdbc.update(
                """
                INSERT INTO users (id, nickname, display_name, password_hash, role, is_hr, created_at)
                VALUES (?, ?, ?, 'test', 'HR', TRUE, CURRENT_TIMESTAMP)
                """.trimIndent(),
                ownerId, "h2-owner-${ownerId.take(8)}", "H2 Owner",
            )
            h2Jdbc.update(
                """
                INSERT INTO teams (id, name, normalized_name, owner_user_id, state, revision, security_revision, merge_revision, created_at, updated_at)
                VALUES (?, 'H2 scheduler', 'h2 scheduler', ?, 'ACTIVE', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """.trimIndent(),
                teamId, ownerId,
            )
            // This is a create-drop mapping prerequisite only. PostgreSQL below
            // remains the Flyway migration/constraint oracle.
            assertRecoveryColumns(h2Jdbc)
            insertRecoveryShape(teamId, ownerId, h2Jdbc, firstExpiredId, "v1:first", "integration-v1", expiresAt = Instant.now().minusSeconds(120))
            insertRecoveryShape(teamId, ownerId, h2Jdbc, secondExpiredId, "v1:second", "integration-v1", expiresAt = Instant.now().minusSeconds(90))
            insertRecoveryShape(teamId, ownerId, h2Jdbc, recheckedCandidateId, "v1:rechecked", "integration-v1", expiresAt = Instant.now().minusSeconds(60))

            assertTrue(invokeH2CleanupThroughBarrier(h2Application, cleanupClass, barrier), "first expired recoverable candidate is cleaned")
            assertRecoveryPair(h2Jdbc, firstExpiredId, null, null, "first selected expired candidate is cleaned")
            assertTrue(
                invokeH2SingleCandidateCleanup(h2Application, cleanupClass),
                "a second cleanup must progress to the next recoverable candidate instead of revisiting the cleared first row",
            )
            assertRecoveryPair(h2Jdbc, secondExpiredId, null, null, "second selected expired candidate is cleaned")

            assertFalse(invokeH2CleanupThroughBarrier(h2Application, cleanupClass, barrier) {
                h2Jdbc.update("UPDATE team_invitations SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().plusSeconds(3600)), recheckedCandidateId)
            }, "a selected candidate made future before its invitation lock must not be cleared")
            assertRecoveryPair(h2Jdbc, recheckedCandidateId, "v1:rechecked", "integration-v1", "candidate changed to future after selection must survive the expiry recheck")
            listOf(firstExpiredId, secondExpiredId, recheckedCandidateId).forEach { invitationId ->
                assertEquals("PENDING", h2Jdbc.queryForObject("SELECT state FROM team_invitations WHERE id=?", String::class.java, invitationId))
            }
        } finally {
            h2Application.close()
        }

        val nonTestApplication = startH2RecoveryApplication(profile = "non-test")
        try {
            assertFalse(nonTestApplication.environment.activeProfiles.contains("test"), "non-test negative control must not inherit the test profile")
            val cleanupClass = resolveH2SingleCandidateCleanupClass()
            val barrierClass = resolveLifecycleTestBarrierClass()
            assertTrue(
                nonTestApplication.getBeansOfType(cleanupClass).isEmpty(),
                "H2 cleanup seam must not be constructed outside the test profile",
            )
            assertTrue(
                nonTestApplication.getBeansOfType(barrierClass).isEmpty(),
                "lifecycle barrier must not be constructed outside the test profile",
            )
        } finally {
            nonTestApplication.close()
        }
    }

    @Test
    fun `startup always validates a canonical AES keyring regardless of legacy workspace configuration`() {
        val validProperties = mapOf(
            "app.team-invitation-link-encryption.active-key-id" to "valid-v1",
            "app.team-invitation-link-encryption.keys.valid-v1" to canonicalKey(32),
        )
        val invalidConfigurations = listOf(
            emptyMap(),
            mapOf("app.team-invitation-link-encryption.active-key-id" to "unknown"),
            mapOf("app.team-invitation-link-encryption.active-key-id" to "bad", "app.team-invitation-link-encryption.keys.bad" to "${"A".repeat(42)}+"),
            mapOf("app.team-invitation-link-encryption.active-key-id" to "short", "app.team-invitation-link-encryption.keys.short" to canonicalKey(31)),
            mapOf("app.team-invitation-link-encryption.active-key-id" to "long", "app.team-invitation-link-encryption.keys.long" to canonicalKey(33)),
            mapOf("app.team-invitation-link-encryption.active-key-id" to "padded", "app.team-invitation-link-encryption.keys.padded" to "${canonicalKey(32)}="),
        )
        for (legacyValue in listOf(null, "false")) {
            val validContext = startStandalone(legacyValue, validProperties)
            validContext?.close()
            assertTrue(validContext != null, "Default and legacy false configuration accept a stable canonical 32-byte key")
            for (invalidConfiguration in invalidConfigurations) {
                val invalidContext = startStandalone(legacyValue, invalidConfiguration)
                invalidContext?.close()
                assertNull(invalidContext, "Missing, unknown, malformed, padded and wrong-length keyrings fail startup")
            }
        }
    }

    private fun startStandalone(legacyValue: String?, encryptionProperties: Map<String, String>): ConfigurableApplicationContext? =
        runCatching {
            val properties = postgres.applicationProperties() + mapOf(
                "spring.main.banner-mode" to "off",
                "app.team-invitation-link-encryption.active-key-id" to "",
            ) + (legacyValue?.let { mapOf("app.features.team-workspaces-enabled" to it) } ?: emptyMap()) + encryptionProperties
            SpringApplicationBuilder(InterviewOnlineApplication::class.java)
                .web(WebApplicationType.NONE)
                .run(*properties.map { (key, value) -> "--$key=$value" }.toTypedArray())
        }.getOrNull()

    private fun startH2RecoveryApplication(
        profile: String,
        webApplicationType: WebApplicationType = WebApplicationType.NONE,
    ): ConfigurableApplicationContext {
        val databaseName = "invitation_recovery_${UUID.randomUUID().toString().replace("-", "")}" 
        val properties = mapOf(
            "spring.main.banner-mode" to "off",
            "spring.datasource.url" to "jdbc:h2:mem:$databaseName;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
            "spring.datasource.username" to "sa",
            "spring.datasource.password" to "",
            "spring.datasource.driver-class-name" to "org.h2.Driver",
            "spring.flyway.enabled" to "false",
            "spring.jpa.hibernate.ddl-auto" to "create-drop",
            "server.port" to "0",
            "app.team-invitation-link-encryption.active-key-id" to "integration-v1",
            "app.team-invitation-link-encryption.keys.integration-v1" to canonicalKey(32),
        )
        return SpringApplicationBuilder(InterviewOnlineApplication::class.java)
            .profiles(profile)
            .web(webApplicationType)
            .run(*properties.map { (key, value) -> "--$key=$value" }.toTypedArray())
    }

    private fun account(prefix: String): HrTestAccount =
        HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun team(owner: HrTestAccount, name: String): TeamFixture {
        val result = mockMvc.post("/api/teams") {
            authorizeRecovery(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "team fixture must exist")
        return TeamFixture(body(result).path("team").path("id").asText())
    }

    private fun seedMembership(teamId: String, userId: String, role: String) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role,
        )
    }

    private fun seedLegacyPending(
        teamId: String,
        creatorId: String,
        database: JdbcTemplate = jdbcTemplate,
        invitationId: String = UUID.randomUUID().toString(),
        rawToken: String = newToken(),
    ): String {
        database.update(
            """
            INSERT INTO team_invitations (id, team_id, token_hash, creator_user_id, role, expires_at, state, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'MEMBER', ?, 'PENDING', 0, ?, ?)
            """.trimIndent(),
            invitationId,
            teamId,
            sha256(rawToken),
            creatorId,
            Timestamp.from(Instant.now().plusSeconds(3600)),
            Timestamp.from(Instant.now()),
            Timestamp.from(Instant.now()),
        )
        return invitationId
    }

    private fun seedLegacyRawToken(teamId: String, creatorId: String): LegacyInvitationRef {
        val token = newToken()
        val id = seedLegacyPending(teamId, creatorId, rawToken = token)
        return LegacyInvitationRef(id, token)
    }

    private fun insertRecoveryShape(
        teamId: String,
        creatorId: String,
        database: JdbcTemplate = jdbcTemplate,
        invitationId: String = UUID.randomUUID().toString(),
        envelope: String?,
        keyVersion: String?,
        state: String = "PENDING",
        expiresAt: Instant = Instant.now().plusSeconds(3600),
    ) {
        database.update(
            """
            INSERT INTO team_invitations (
                id, team_id, token_hash, creator_user_id, role, expires_at, state, revision,
                created_at, updated_at, recoverable_token_envelope, recovery_key_version
            ) VALUES (?, ?, ?, ?, 'MEMBER', ?, ?, 0, ?, ?, ?, ?)
            """.trimIndent(),
            invitationId,
            teamId,
            sha256(newToken()),
            creatorId,
            Timestamp.from(expiresAt),
            state,
            Timestamp.from(Instant.now()),
            Timestamp.from(Instant.now()),
            envelope,
            keyVersion,
        )
    }

    private fun create(actor: HrTestAccount, teamId: String): MvcResult = mockMvc.post("/api/teams/$teamId/invitations") {
        authorizeRecovery(actor)
        header("Idempotency-Key", UUID.randomUUID().toString())
        contentType = MediaType.APPLICATION_JSON
        content = "{}"
    }.andReturn()

    private fun createAndReveal(actor: HrTestAccount, teamId: String): InvitationRef {
        val created = create(actor, teamId)
        assertStatus(created, 201, "invitation fixture must be created")
        val id = invitation(created).path("id").asText()
        val reveal = reveal(actor, teamId, id)
        assertStatus(reveal, 200, "fixture requires the explicit recovery endpoint")
        val url = body(reveal).path("url").asText()
        return InvitationRef(id, url, tokenFromUrl(url))
    }

    private fun list(actor: HrTestAccount, teamId: String, page: Int? = null, size: Int? = null): MvcResult = mockMvc.get("/api/teams/$teamId/invitations") {
        authorizeRecovery(actor)
        page?.let { param("page", it.toString()) }
        size?.let { param("size", it.toString()) }
    }.andReturn()

    private fun reveal(actor: HrTestAccount, teamId: String, invitationId: String): MvcResult =
        mockMvc.get("/api/teams/$teamId/invitations/$invitationId/link") { authorizeRecovery(actor) }.andReturn()

    private fun accept(actor: HrTestAccount, token: String): MvcResult = mockMvc.post("/api/team-invitations/accept") {
        authorizeRecovery(actor)
        header("Idempotency-Key", UUID.randomUUID().toString())
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("token" to token))
    }.andReturn()

    private fun preview(token: String): MvcResult = mockMvc.post("/api/team-invitations/preview") {
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("token" to token))
    }.andReturn()

    private fun revoke(actor: HrTestAccount, teamId: String, invitationId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/invitations/$invitationId/revoke") {
            authorizeRecovery(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun reissue(actor: HrTestAccount, teamId: String, invitationId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/invitations/$invitationId/reissue") {
            authorizeRecovery(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun invitation(result: MvcResult): JsonNode = body(result).path("invitation")
        .takeIf { !it.isMissingNode && !it.isNull } ?: body(result)

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)

    private fun metadata(result: MvcResult, invitationId: String): JsonNode = body(result).path("items")
        .firstOrNull { it.path("id").asText() == invitationId }
        ?: error("expected safe invitation metadata row")

    private fun activeMembershipCount(teamId: String, userId: String): Long = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM team_memberships WHERE team_id=? AND user_id=? AND state='ACTIVE'",
        Long::class.java,
        teamId,
        userId,
    ) ?: 0L

    private fun invitationCount(teamId: String): Long = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM team_invitations WHERE team_id=?",
        Long::class.java,
        teamId,
    ) ?: 0L

    private fun recoveryPairCount(teamId: String): Long = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*) FROM team_invitations
        WHERE team_id=?
          AND recoverable_token_envelope IS NOT NULL
          AND recovery_key_version IS NOT NULL
        """.trimIndent(),
        Long::class.java,
        teamId,
    ) ?: 0L

    private fun transplantRecoveryMaterial(sourceInvitationId: String, targetInvitationId: String) {
        val source = jdbcTemplate.queryForMap(
            "SELECT token_hash, recoverable_token_envelope, recovery_key_version FROM team_invitations WHERE id=?",
            sourceInvitationId,
        )
        jdbcTemplate.update("DELETE FROM team_invitations WHERE id=?", sourceInvitationId)
        jdbcTemplate.update(
            """
            UPDATE team_invitations
            SET token_hash=?, recoverable_token_envelope=?, recovery_key_version=?
            WHERE id=?
            """.trimIndent(),
            source["token_hash"],
            source["recoverable_token_envelope"],
            source["recovery_key_version"],
            targetInvitationId,
        )
    }

    private fun invitationState(invitationId: String): String = jdbcTemplate.queryForObject(
        "SELECT state FROM team_invitations WHERE id=?",
        String::class.java,
        invitationId,
    ) ?: error("invitation fixture must exist")

    private fun invitationStateAndRevision(invitationId: String): InvitationState = jdbcTemplate.queryForObject(
        "SELECT state, revision FROM team_invitations WHERE id=?",
        { resultSet, _ -> InvitationState(resultSet.getString("state"), resultSet.getLong("revision")) },
        invitationId,
    ) ?: error("invitation fixture must exist")

    private fun tokenFromUrl(url: String): String = URI("https://local.test$url").fragment.removePrefix("token=")

    private fun newToken(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))

    private fun canonicalKey(length: Int): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(length))

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun assertExactInvitationMetadata(value: JsonNode) {
        assertEquals(invitationMetadataFields, value.fieldNames().asSequence().toSet(), "invitation metadata field allowlist changed")
        assertTrue(value.path("id").asText().isNotBlank())
        assertEquals("MEMBER", value.path("role").asText())
        assertTrue(value.path("state").asText() in setOf("PENDING", "ACCEPTED", "REVOKED", "EXPIRED"))
        assertTrue(value.path("expiresAt").asText().isNotBlank())
        assertTrue(value.path("revision").isIntegralNumber)
        assertTrue(value.path("linkRecoverability").asText() in setOf("RECOVERABLE", "UNRECOVERABLE_LEGACY", "NOT_APPLICABLE"))
    }

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertStatusAndCode(result: MvcResult, expected: Int, code: String) {
        assertStatus(result, expected, "unexpected invitation recovery HTTP status")
        assertEquals(code, body(result).path("code").asText(), "unexpected invitation recovery code")
    }

    private fun assertExactInvitationDenial(result: MvcResult, expected: Int, code: String) {
        assertStatusAndCode(result, expected, code)
        assertProtectedNoStore(result)
        assertEquals(
            invitationDenialFields,
            body(result).fieldNames().asSequence().toSet(),
            "invitation denial must remain a metadata-free error allowlist",
        )
        assertFalse(body(result).has("items"), "invitation denial cannot carry list metadata")
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "response must remain private and non-cacheable")
    }

    private fun assertEnvelopeCleared(invitationId: String, marker: String) {
        val values = jdbcTemplate.queryForMap(
            "SELECT recoverable_token_envelope, recovery_key_version FROM team_invitations WHERE id=?",
            invitationId,
        )
        assertEquals(null, values["recoverable_token_envelope"], marker)
        assertEquals(null, values["recovery_key_version"], marker)
    }

    private fun assertRecoveryColumns(database: JdbcTemplate = jdbcTemplate) {
        val columns = database.queryForList(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name='team_invitations'
              AND column_name IN ('recoverable_token_envelope', 'recovery_key_version')
            """.trimIndent(),
            String::class.java,
        ).toSet()
        assertEquals(setOf("recoverable_token_envelope", "recovery_key_version"), columns, "recovery persistence must contain the all-or-none pair")
    }

    private fun assertRecoveryPair(
        database: JdbcTemplate,
        invitationId: String,
        envelope: String?,
        keyVersion: String?,
        marker: String,
    ) {
        val values = database.queryForMap(
            "SELECT recoverable_token_envelope, recovery_key_version FROM team_invitations WHERE id=?",
            invitationId,
        )
        assertEquals(envelope, values["recoverable_token_envelope"], marker)
        assertEquals(keyVersion, values["recovery_key_version"], marker)
    }

    private fun resolveH2SingleCandidateCleanupClass(): Class<*> {
        val cleanupClass = runCatching { Class.forName("com.interviewonline.service.TeamInvitationExpiryCleanup") }.getOrNull()
        assertTrue(cleanupClass != null, "expiry cleanup must expose the documented H2-compatible single-candidate test path")
        return requireNotNull(cleanupClass)
    }

    private fun invokeH2SingleCandidateCleanup(application: ConfigurableApplicationContext, cleanupClass: Class<*>): Boolean {
        val cleanup = application.getBean(cleanupClass)
        val method = cleanupClass.methods.singleOrNull { it.name == "cleanupOneCandidateForH2Test" && it.parameterCount == 0 }
        assertTrue(method != null, "expiry cleanup must provide cleanupOneCandidateForH2Test() without PostgreSQL-only SQL")
        return method!!.invoke(cleanup) as Boolean
    }

    private fun assertNoHttpExposure(application: ConfigurableApplicationContext, vararg internalTypes: Class<*>) {
        val mapped = application.getBeansOfType(RequestMappingHandlerMapping::class.java).values
            .asSequence()
            .flatMap { mapping -> mapping.handlerMethods.values.asSequence() }
            .any { handler ->
                internalTypes.any { internalType -> internalType.isAssignableFrom(handler.beanType) } ||
                    handler.method.name in setOf("cleanupOneCandidateForH2Test", "afterTeamLockBeforeInvitationLock")
            }
        assertFalse(mapped, "test-only lifecycle seams must never be HTTP mappings")
    }

    private fun resolveLifecycleTestBarrierClass(): Class<*> {
        val barrierClass = runCatching { Class.forName("com.interviewonline.service.InvitationLifecycleTestBarrier") }.getOrNull()
        assertTrue(barrierClass != null, "test profile must supply InvitationLifecycleTestBarrier after team lock and before invitation lock")
        return requireNotNull(barrierClass)
    }

    private fun lifecycleTestBarrier(application: ApplicationContext): LifecycleBarrierHarness {
        val barrierClass = resolveLifecycleTestBarrierClass()
        return LifecycleBarrierHarness(application.getBean(barrierClass), barrierClass)
    }

    private fun invokeH2CleanupThroughBarrier(
        application: ConfigurableApplicationContext,
        cleanupClass: Class<*>,
        barrier: LifecycleBarrierHarness,
        afterArrival: () -> Unit = {},
    ): Boolean {
        val executor = Executors.newSingleThreadExecutor()
        barrier.arm()
        try {
            val cleanup = executor.submit(Callable { invokeH2SingleCandidateCleanup(application, cleanupClass) })
            assertTrue(barrier.awaitArrival(), "selected H2 cleanup candidate must pause after team lock and before invitation lock")
            afterArrival()
            barrier.releaseOne()
            return cleanup.get(15, TimeUnit.SECONDS)
        } finally {
            barrier.reset()
            executor.shutdownNow()
        }
    }

    private fun releasedLifecycleRace(vararg operations: Pair<String, () -> MvcResult>): Map<String, MvcResult> {
        require(operations.size == 2) { "each lifecycle race covers exactly one competing pair" }
        val barrier = lifecycleTestBarrier(applicationContext)
        val ready = CountDownLatch(operations.size)
        val executor = Executors.newFixedThreadPool(operations.size)
        barrier.arm()
        return try {
            val futures = operations.map { (name, operation) ->
                executor.submit(Callable {
                    ready.countDown()
                    name to operation()
                })
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS), "both HTTP lifecycle operations must start")
            assertTrue(barrier.awaitArrival(), "first lifecycle transaction must pause after team lock and before invitation lock")
            barrier.releaseOne()
            assertTrue(barrier.awaitArrival(), "second lifecycle transaction must reach the same post-team-lock barrier")
            barrier.releaseOne()
            futures.associate { it.get(15, TimeUnit.SECONDS) }
        } finally {
            barrier.reset()
            executor.shutdownNow()
        }
    }

    private fun lifecycleWinner(outcomes: Map<String, MvcResult>): String = outcomes.entries.single {
        it.value.response.status in 200..299
    }.key

    private fun assertAcceptWinner(teamId: String, original: InvitationRef, recipient: HrTestAccount) {
        assertEquals("ACCEPTED", invitationState(original.id), "accept winner terminalizes original invitation")
        assertEquals(1L, activeMembershipCount(teamId, recipient.id), "accept winner creates exactly one active membership")
        assertEquals(1L, invitationCount(teamId), "accept winner creates no replacement invitation")
    }

    private fun assertReissueWinner(teamId: String, original: InvitationRef, owner: HrTestAccount, recipient: HrTestAccount?) {
        assertEquals("REVOKED", invitationState(original.id), "reissue winner revokes original invitation")
        assertEquals(2L, invitationCount(teamId), "reissue winner creates exactly one replacement")
        recipient?.let { assertEquals(0L, activeMembershipCount(teamId, it.id), "reissue winner does not create recipient membership") }
        val replacementId = jdbcTemplate.queryForObject(
            "SELECT id FROM team_invitations WHERE team_id=? AND id<>?",
            String::class.java,
            teamId,
            original.id,
        ) ?: error("reissue winner must persist replacement")
        val replacementReveal = reveal(owner, teamId, replacementId)
        assertStatus(replacementReveal, 200, "reissue winner replacement is recoverable only by reissuing manager")
        assertProtectedNoStore(replacementReveal)
    }

    private fun assertRevokeWinner(teamId: String, original: InvitationRef, recipient: HrTestAccount?) {
        assertEquals("REVOKED", invitationState(original.id), "revoke winner terminalizes original invitation")
        assertEquals(1L, invitationCount(teamId), "revoke winner creates no replacement")
        recipient?.let { assertEquals(0L, activeMembershipCount(teamId, it.id), "revoke winner does not create recipient membership") }
    }

    private fun assertTerminalOriginalHasNoStaleReveal(teamId: String, original: InvitationRef, owner: HrTestAccount) {
        assertEnvelopeCleared(original.id, "terminal lifecycle outcome clears recovery pair atomically")
        val staleReveal = reveal(owner, teamId, original.id)
        assertStatusAndCode(staleReveal, 410, "INVITATION_LINK_UNAVAILABLE")
        assertProtectedNoStore(staleReveal)
    }

    private class LifecycleBarrierHarness(val instance: Any, val type: Class<*>) {
        fun arm() = invoke("arm")

        fun awaitArrival(): Boolean = invoke("awaitArrival", 10_000L) as? Boolean ?: false

        fun releaseOne() = invoke("releaseOne")

        fun reset() = invoke("reset")

        private fun invoke(name: String, vararg arguments: Any): Any? {
            val argumentTypes = arguments.map { argument ->
                if (argument is Long) Long::class.javaPrimitiveType else argument.javaClass
            }.toTypedArray()
            val method = type.methods.singleOrNull { candidate ->
                candidate.name == name && candidate.parameterTypes.contentEquals(argumentTypes)
            }
            assertTrue(method != null, "InvitationLifecycleTestBarrier must expose $name for deterministic test coordination")
            return method!!.invoke(instance, *arguments)
        }
    }

    private fun assertOneLifecycleWinner(outcomes: Map<String, MvcResult>, marker: String) {
        val successful = outcomes.values.count { it.response.status in 200..299 }
        assertEquals(1, successful, "$marker must commit exactly one lifecycle outcome")
        outcomes.values.filter { it.response.status !in 200..299 }.forEach { loser ->
            assertTrue(loser.response.status in setOf(409, 410, 503), "$marker loser must be stale, unavailable or retryable busy")
            assertProtectedNoStore(loser)
        }
    }

    private fun captureNoSecretLogs(work: () -> MvcResult): CapturedResult {
        val logger = LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger
        val appender = ListAppender<ILoggingEvent>()
        appender.start()
        logger.addAppender(appender)
        val result = try {
            work()
        } finally {
            logger.detachAppender(appender)
            appender.stop()
        }
        return CapturedResult(result, appender.list.toList())
    }

    private data class TeamFixture(val id: String)
    private data class InvitationRef(val id: String, val url: String, val token: String)
    private data class LegacyInvitationRef(val id: String, val token: String)
    private data class InvitationState(val state: String, val revision: Long)
    private data class CapturedResult(val result: MvcResult, val events: List<ILoggingEvent>) {
        fun assertNoToken(token: String) {
            assertFalse(events.any { it.formattedMessage.contains(token) || throwableContains(it.throwableProxy, token) }, "invitation bearer must not appear in logs")
        }

        private fun throwableContains(proxy: ch.qos.logback.classic.spi.IThrowableProxy?, token: String): Boolean =
            proxy != null && (proxy.message?.contains(token) == true || throwableContains(proxy.cause, token))
    }

    private val invitationMetadataFields = setOf("id", "state", "role", "expiresAt", "revision", "canReveal", "linkRecoverability")
    private val invitationDenialFields = setOf("error", "code")
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorizeRecovery(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
