package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.InterviewOnlineApplication
import com.interviewonline.service.CollaborationService
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.WebApplicationType
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import java.util.UUID
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(
    properties = [
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ],
)
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamAccessIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
    @Autowired private val collaborationService: CollaborationService,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_access")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `integration contract runs on isolated PostgreSQL 16`() {
        postgres.verifyPostgres16()
    }

    @Test
    fun `unauthenticated workspace team and command reads are rejected before lookup`() {
        val teamId = UUID.randomUUID().toString()
        val key = UUID.randomUUID().toString()
        val denials = listOf(
            mockMvc.get("/api/me/workspaces").andReturn().expectStatus(401),
            mockMvc.get("/api/teams/$teamId").andReturn().expectStatus(401),
            mockMvc.get("/api/me/commands/$key") {
                param("scope", "personal")
                param("operation", "TEAM_CREATE")
            }.andReturn().expectStatus(401),
        )
        denials.forEach { assertNonDisclosingDenial(it, listOf(teamId, key)) }
    }

    @Test
    fun `authentication key validation and authority fields are rejected before writes`() {
        val unauthenticated = teamCreate(name = "Atlas", key = UUID.randomUUID().toString()).expectStatus(401)
        assertProtectedNoStore(unauthenticated)
        assertNoPrivateFields(unauthenticated.response.contentAsString)
        val actor = register("team-validation")
        val beforeTeams = count("teams", "owner_user_id = ?", actor.id)
        val beforeReceipts = count("command_receipts", "actor_user_id = ?", actor.id)
        val missingKey = teamCreate(actor, "Atlas", null).expectStatusAndCode(400, "IDEMPOTENCY_KEY_REQUIRED")
        val invalidKey = teamCreate(actor, "Atlas", "not-a-uuid").expectStatusAndCode(400, "INVALID_IDEMPOTENCY_KEY")
        val forgedAuthority = teamCreate(
            actor,
            key = UUID.randomUUID().toString(),
            rawBody = """{"name":"Atlas","actorUserId":"forged","scopeKind":"TEAM","scopeId":"forged"}""",
        ).expectStatus(400)
        listOf(missingKey, invalidKey, forgedAuthority).forEach {
            assertNonDisclosingDenial(it, listOf(actor.id, actor.token, "Atlas"))
        }
        assertEquals(beforeTeams, count("teams", "owner_user_id = ?", actor.id))
        assertEquals(beforeReceipts, count("command_receipts", "actor_user_id = ?", actor.id))
    }

    @Test
    fun `idempotency keys require canonical UUID text at create and outcome boundaries`() {
        val actor = register("team-canonical-key")
        val beforeTeams = count("teams", "owner_user_id = ?", actor.id)
        val beforeReceipts = count("command_receipts", "actor_user_id = ?", actor.id)
        val shortened = "1-1-1-1-1"
        val expanded = "000000001-0001-0001-0001-000000000001"

        val shortenedCreate = teamCreate(actor, "Short key", shortened)
            .expectStatusAndCode(400, "INVALID_IDEMPOTENCY_KEY")
        val expandedCreate = teamCreate(actor, "Expanded key", expanded)
            .expectStatusAndCode(400, "INVALID_IDEMPOTENCY_KEY")
        listOf(shortenedCreate, expandedCreate).forEach { denial ->
            assertNonDisclosingDenial(denial, listOf(actor.id, actor.token, "Short key", "Expanded key"))
        }
        assertEquals(beforeTeams, count("teams", "owner_user_id = ?", actor.id))
        assertEquals(beforeReceipts, count("command_receipts", "actor_user_id = ?", actor.id))

        val canonicalUpper = UUID.randomUUID().toString().uppercase()
        val created = teamCreate(actor, "Uppercase UUID", canonicalUpper).expectStatus(201)
        val teamId = teamId(created)
        val outcome = mockMvc.get("/api/me/commands/$canonicalUpper") {
            authorize(actor)
            param("scope", "personal")
            param("operation", "TEAM_CREATE")
        }.andReturn().expectStatus(200)
        assertSafeCommandOutcome(outcome, teamId)

        val unknownCanonical = UUID.randomUUID().toString()
        val unknown = mockMvc.get("/api/me/commands/$unknownCanonical") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        val shortenedOutcome = mockMvc.get("/api/me/commands/$shortened") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        val expandedOutcome = mockMvc.get("/api/me/commands/$expanded") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        listOf(shortenedOutcome, expandedOutcome).forEach { denial ->
            assertEquals(safe404(unknown), safe404(denial), "non-canonical and unknown command keys must be indistinguishable")
            assertNonDisclosingDenial(denial, listOf(teamId, actor.id, actor.token, "Uppercase UUID"))
        }
    }

    @Test
    fun `team name uses trim and NFKC with exact code point boundaries`() {
        val actor = register("team-name")
        listOf(
            teamCreate(actor, "   ", UUID.randomUUID().toString()).expectStatus(400),
            teamCreate(actor, "Я".repeat(101), UUID.randomUUID().toString()).expectStatus(400),
            teamCreate(actor, "😀".repeat(101), UUID.randomUUID().toString()).expectStatus(400),
        ).forEach { invalid ->
            assertCacheControlDirectives(invalid, "private", "no-store")
            assertNoPrivateFields(invalid.response.contentAsString)
        }
        val one = teamCreate(actor, "Я", UUID.randomUUID().toString()).expectStatus(201)
        assertEquals("Я", json(one).path("team").path("name").asText())
        val hundredName = "Я".repeat(100)
        val hundred = teamCreate(actor, hundredName, UUID.randomUUID().toString()).expectStatus(201)
        assertEquals(hundredName, json(hundred).path("team").path("name").asText())
        val hundredAstral = "😀".repeat(100)
        val astralBoundary = teamCreate(actor, hundredAstral, UUID.randomUUID().toString()).expectStatus(201)
        assertEquals(hundredAstral, json(astralBoundary).path("team").path("name").asText())
        val normalized = teamCreate(actor, " \u3000Ａtlas\u3000 ", UUID.randomUUID().toString()).expectStatus(201)
        assertEquals("Atlas", json(normalized).path("team").path("name").asText())
    }

    @Test
    fun `first create and sequential canonical replay return byte equivalent outcome`() {
        val actor = register("team-replay")
        val key = UUID.randomUUID().toString()
        val first = teamCreate(actor, "  Atlas  ", key).expectStatus(201)
        val replay = teamCreate(actor, key = key, rawBody = """{
            "name" : "\u3000Ａtlas\u3000"
        }""".trimIndent()).expectStatus(201)
        val teamId = json(first).path("team").path("id").asText()
        assertTrue(teamId.isNotBlank())
        assertEquals("Atlas", json(first).path("team").path("name").asText())
        assertEquals("OWNER", json(first).path("membership").path("role").asText())
        assertEquals("/api/teams/$teamId", first.response.getHeader("Location"))
        assertProtectedNoStore(first)
        assertNoPrivateFields(first.response.contentAsString)
        assertEquals(first.response.contentAsByteArray.toList(), replay.response.contentAsByteArray.toList())
        assertEquals(first.response.getHeader("Location"), replay.response.getHeader("Location"))
        assertExactCreateRows(actor.id, teamId, key)
        val firstHash = assertReceiptCanonicalContract(actor.id, key)
        val equivalentKey = UUID.randomUUID().toString()
        val equivalent = teamCreate(actor, "Atlas", equivalentKey).expectStatus(201)
        val equivalentId = teamId(equivalent)
        val equivalentHash = assertReceiptCanonicalContract(actor.id, equivalentKey)
        assertEquals(firstHash, equivalentHash, "NFKC+trim equivalent bodies must produce the same versioned canonical hash")
        val changedKey = UUID.randomUUID().toString()
        val changed = teamCreate(actor, "atlas", changedKey).expectStatus(201)
        val changedId = teamId(changed)
        val changedHash = assertReceiptCanonicalContract(actor.id, changedKey)
        assertNotEquals(firstHash, changedHash, "saved case/content is part of canonical intent")
        assertExactCreateRows(actor.id, equivalentId, equivalentKey)
        assertExactCreateRows(actor.id, changedId, changedKey)
        assertReceiptStoragePrivacy(
            actor.id,
            teamId,
            key,
            listOf("  Atlas  ", "\u3000Ａtlas\u3000", actor.token),
        )

        val inspected = mockMvc.get("/api/me/commands/$key") {
            authorize(actor)
            param("scope", "personal")
            param("operation", "TEAM_CREATE")
        }.andReturn().expectStatus(200)
        assertSafeCommandOutcome(inspected, teamId)
    }

    @Test
    fun `terminal receipt is usable before expiry and unavailable at and after expiry without duplicate create`() {
        val actor = register("team-expiry")
        val key = UUID.randomUUID().toString()
        val first = teamCreate(actor, "Expiry Atlas", key).expectStatus(201)
        val teamId = teamId(first)

        jdbcTemplate.update(
            "UPDATE command_receipts SET created_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '23 hours 55 minutes', " +
                "expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '5 minutes' " +
                "WHERE actor_user_id = ? AND idempotency_key = ?",
            actor.id,
            key,
        )
        val beforeExpiry = teamCreate(actor, "Expiry Atlas", key).expectStatus(201)
        assertEquals(first.response.contentAsByteArray.toList(), beforeExpiry.response.contentAsByteArray.toList())
        val beforeOutcome = mockMvc.get("/api/me/commands/$key") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatus(200)
        assertSafeCommandOutcome(beforeOutcome, teamId)

        jdbcTemplate.update(
            "UPDATE command_receipts SET created_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours', " +
                "expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE actor_user_id = ? AND idempotency_key = ?",
            actor.id,
            key,
        )
        val atExpiry = teamCreate(actor, "Expiry Atlas", key)
            .expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        val atOutcome = mockMvc.get("/api/me/commands/$key") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        assertEquals(safe404(atOutcome), safe404(atExpiry), "POST replay and outcome are equally unavailable at expiry")

        jdbcTemplate.update(
            "UPDATE command_receipts SET created_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours 1 second', " +
                "expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 second' " +
                "WHERE actor_user_id = ? AND idempotency_key = ?",
            actor.id,
            key,
        )
        val afterExpiry = teamCreate(actor, "Expiry Atlas", key)
            .expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        val changedAfterExpiry = teamCreate(actor, "Different private name", key)
            .expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        assertEquals(safe404(atExpiry), safe404(afterExpiry))
        assertEquals(safe404(afterExpiry), safe404(changedAfterExpiry), "expired receipt must not disclose hash reuse")
        listOf(atExpiry, atOutcome, afterExpiry, changedAfterExpiry).forEach { denial ->
            assertNonDisclosingDenial(
                denial,
                listOf(teamId, actor.id, actor.token, "Expiry Atlas", "Different private name"),
            )
        }
        assertExactCreateRows(actor.id, teamId, key)
        assertEquals(1L, count("teams", "owner_user_id = ?", actor.id))
    }

    @Test
    fun `reused key with different canonical body conflicts without disclosure`() {
        val actor = register("team-reused")
        val key = UUID.randomUUID().toString()
        val first = teamCreate(actor, "Atlas", key).expectStatus(201)
        val teamId = json(first).path("team").path("id").asText()
        val conflict = teamCreate(actor, "atlas", key).expectStatusAndCode(409, "IDEMPOTENCY_KEY_REUSED")
        assertNonDisclosingDenial(conflict, listOf(teamId, "Atlas", actor.id, actor.token))
        assertFalse(conflict.response.contentAsString.contains(teamId))
        assertFalse(conflict.response.contentAsString.contains("Atlas"))
        assertFalse(conflict.response.contentAsString.contains("resourceId"))
        assertExactCreateRows(actor.id, teamId, key)
    }

    @Test
    fun `same UUID is independent for another actor`() {
        val firstActor = register("team-namespace-a")
        val secondActor = register("team-namespace-b")
        val key = UUID.randomUUID().toString()
        val first = teamCreate(firstActor, "Atlas", key).expectStatus(201)
        val second = teamCreate(secondActor, "Orbit", key).expectStatus(201)
        val firstId = json(first).path("team").path("id").asText()
        val secondId = json(second).path("team").path("id").asText()
        assertNotEquals(firstId, secondId)
        assertExactCreateRows(firstActor.id, firstId, key)
        assertExactCreateRows(secondActor.id, secondId, key)
    }

    @Test
    fun `twenty concurrent repeats resolve one team and one terminal receipt`() {
        val actor = register("team-concurrent")
        val key = UUID.randomUUID().toString()
        val ready = CountDownLatch(20)
        val release = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(20)
        val futures = (1..20).map {
            executor.submit(Callable {
                ready.countDown()
                release.await(10, TimeUnit.SECONDS)
                teamCreate(actor, "  Ａtlas  ", key)
            })
        }
        assertTrue(ready.await(10, TimeUnit.SECONDS))
        release.countDown()
        val initial = try {
            futures.map { it.get(20, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
        val resolved = initial.map { it.expectStatus(201) }
        assertEquals(1, resolved.map { it.response.contentAsString }.toSet().size)
        assertEquals(1, resolved.map { it.response.getHeader("Location") }.toSet().size)
        val teamId = json(resolved.first()).path("team").path("id").asText()
        assertExactCreateRows(actor.id, teamId, key)
        assertEquals(1L, count("teams", "owner_user_id = ?", actor.id))
        assertEquals(1L, count("team_memberships", "team_id = ?", teamId))
        assertEquals(1L, count("team_audit_events", "actor_user_id = ? AND action = 'TEAM_CREATE'", actor.id))
        assertEquals(1L, count("command_receipts", "actor_user_id = ? AND idempotency_key = ?", actor.id, key))
    }

    @Test
    fun `terminal receipt insert failure rolls back all rows and the same key retries`() {
        val actor = register("team-rollback")
        val key = UUID.randomUUID().toString()
        assertTrue(tableExists("command_receipts"), "team migration must provide command_receipts before the rollback seam is installed")
        val suffix = UUID.randomUUID().toString().replace("-", "")
        val function = "fail_team_receipt_$suffix"
        val trigger = "fail_team_receipt_trigger_$suffix"
        jdbcTemplate.execute(
            """
            CREATE FUNCTION $function() RETURNS trigger AS ${'$'}body${'$'}
            BEGIN
              IF NEW.actor_user_id = '${actor.id}' AND NEW.idempotency_key::text = '$key' THEN
                RAISE EXCEPTION 'forced terminal receipt failure';
              END IF;
              RETURN NEW;
            END;
            ${'$'}body${'$'} LANGUAGE plpgsql
            """.trimIndent(),
        )
        jdbcTemplate.execute("CREATE TRIGGER $trigger BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION $function()")
        try {
            val failure = teamCreate(actor, "Atlas rollback", key).expectStatus(503)
            assertNonDisclosingDenial(failure, listOf(actor.id, actor.token, key, "Atlas rollback"))
            assertEquals(0L, count("teams", "owner_user_id = ?", actor.id))
            assertEquals(0L, count("team_memberships", "user_id = ?", actor.id))
            assertEquals(0L, count("team_audit_events", "actor_user_id = ?", actor.id))
            assertEquals(0L, count("command_receipts", "actor_user_id = ? AND idempotency_key = ?", actor.id, key))
        } finally {
            jdbcTemplate.execute("DROP TRIGGER $trigger ON command_receipts")
            jdbcTemplate.execute("DROP FUNCTION $function()")
        }
        val retry = teamCreate(actor, "Atlas rollback", key).expectStatus(201)
        assertExactCreateRows(actor.id, json(retry).path("team").path("id").asText(), key)
    }

    @Test
    fun `terminal replay is unavailable after membership loss`() {
        val actor = register("team-lost-access")
        val successor = register("team-successor")
        val key = UUID.randomUUID().toString()
        val first = teamCreate(actor, "Atlas private", key).expectStatus(201)
        val teamId = json(first).path("team").path("id").asText()
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships
                (id,team_id,user_id,role,state,epoch,revision,created_at,updated_at)
            VALUES (?,?,?,?, 'ACTIVE',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
            """.trimIndent(),
            UUID.randomUUID().toString(),
            teamId,
            successor.id,
            "MEMBER",
        )
        jdbcTemplate.update("UPDATE teams SET owner_user_id = ?, revision = revision + 1 WHERE id = ?", successor.id, teamId)
        jdbcTemplate.update(
            "UPDATE team_memberships SET state = 'REMOVED', epoch = epoch + 1, revision = revision + 1 WHERE team_id = ? AND user_id = ?",
            teamId,
            actor.id,
        )
        val sameBody = teamCreate(actor, "Atlas private", key).expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        val differentBody = teamCreate(actor, "Changed secret", key).expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        assertEquals(safe404(sameBody), safe404(differentBody), "authorization must precede receipt hash disclosure")

        val lostReceipt = mockMvc.get("/api/me/commands/$key") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        val unknownReceipt = mockMvc.get("/api/me/commands/${UUID.randomUUID()}") {
            authorize(actor); param("scope", "personal"); param("operation", "TEAM_CREATE")
        }.andReturn().expectStatusAndCode(404, "COMMAND_NOT_FOUND")
        assertEquals(safe404(lostReceipt), safe404(unknownReceipt), "lost and unknown receipts must be indistinguishable")

        val unknownTeam = mockMvc.get("/api/teams/${UUID.randomUUID()}") { authorize(actor) }
            .andReturn().expectStatusAndCode(404, "TEAM_NOT_FOUND")
        listOf(sameBody, differentBody, lostReceipt, unknownReceipt, unknownTeam).forEach { unavailable ->
            assertNonDisclosingDenial(
                unavailable,
                listOf(teamId, "Atlas private", "Changed secret", actor.id, actor.token),
            )
            assertFalse(unavailable.response.contentAsString.contains("resourceId"))
        }
        assertEquals(1L, count("teams", "id = ?", teamId))
        assertEquals(1L, count("command_receipts", "actor_user_id = ? AND idempotency_key = ? AND resource_id = ?", actor.id, key, teamId))
    }

    @Test
    fun `workspace list and detail expose only personal and active memberships`() {
        val actor = register("team-workspaces")
        val stranger = register("team-foreign")
        val atlasId = teamId(teamCreate(actor, "Atlas", UUID.randomUUID().toString()).expectStatus(201))
        val suspendedId = teamId(teamCreate(actor, "Suspended", UUID.randomUUID().toString()).expectStatus(201))
        val removedId = teamId(teamCreate(actor, "Removed", UUID.randomUUID().toString()).expectStatus(201))
        val mergedId = teamId(teamCreate(actor, "Merged", UUID.randomUUID().toString()).expectStatus(201))
        jdbcTemplate.update("UPDATE team_memberships SET state = 'SUSPENDED' WHERE team_id = ? AND user_id = ?", suspendedId, actor.id)
        jdbcTemplate.update("UPDATE team_memberships SET state = 'REMOVED' WHERE team_id = ? AND user_id = ?", removedId, actor.id)
        jdbcTemplate.update("UPDATE teams SET state = 'MERGED' WHERE id = ?", mergedId)
        val foreignId = teamId(teamCreate(stranger, "Atlas", UUID.randomUUID().toString()).expectStatus(201))
        val workspaces = mockMvc.get("/api/me/workspaces") { authorize(actor) }.andReturn().expectStatus(200)
        assertProtectedNoStore(workspaces)
        val projection = json(workspaces)
        assertTrue(projection.isArray, "workspace projection must be a JSON array")
        val items = projection.toList()
        val personal = items.single { it.path("name").asText() == "Личное пространство" }
        val atlas = items.single { it.path("id").asText() == atlasId }
        listOf(personal, atlas).forEach { item ->
            assertEquals(setOf("id", "name", "role", "epoch", "capabilities"), item.fieldNames().asSequence().toSet())
            assertTrue(item.path("epoch").isIntegralNumber)
            assertFalse(item.path("capabilities").isMissingNode)
        }
        assertEquals("OWNER", atlas.path("role").asText(), "owner role is an effective projection")
        assertFalse(items.any { it.path("id").asText() in setOf(suspendedId, removedId, mergedId, foreignId) })
        assertNoPrivateFields(workspaces.response.contentAsString)
        val detail = mockMvc.get("/api/teams/$atlasId") { authorize(actor) }.andReturn().expectStatus(200)
        assertProtectedNoStore(detail)
        assertNoPrivateFields(detail.response.contentAsString)
        val foreign = mockMvc.get("/api/teams/$foreignId") { authorize(actor) }.andReturn()
            .expectStatusAndCode(404, "TEAM_NOT_FOUND")
        assertNonDisclosingDenial(foreign, listOf(foreignId, "Atlas"))
    }

    @Test
    fun `TEAM room is excluded from personal and HR routes and legacy grants`() {
        val teamOwner = register("team-room-owner")
        val legacyOwner = register("team-legacy-owner", isHr = true)
        val teamId = teamId(teamCreate(teamOwner, "Atlas", UUID.randomUUID().toString()).expectStatus(201))
        val personalRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, legacyOwner, "Personal visible room")
        val teamRoom = prepareLegacyTeamRoom(mockMvc, objectMapper, jdbcTemplate, legacyOwner, teamId, "feature-on")
        assertEquals(1L, count("room_participants", "room_id = ? AND user_id = ? AND role = 'candidate'", teamRoom.room.id, teamRoom.candidate.id))
        assertLegacyTeamRoomIsolation(mockMvc, objectMapper, jdbcTemplate, legacyOwner, personalRoom, teamRoom)
        val teamOwnerWithoutRoomGrant = mockMvc.get("/api/rooms/${teamRoom.room.inviteCode}") { authorize(teamOwner) }
            .andReturn().expectStatus(404)
        assertNonDisclosingDenial(
            teamOwnerWithoutRoomGrant,
            listOf(teamRoom.room.id, teamRoom.room.inviteCode, teamRoom.ownerToken, teamRoom.interviewerToken, teamRoom.eventToken),
        )
    }

    @Test
    fun `deferred personal persistence cannot cross a room scope transition`() {
        val owner = register("team-deferred-owner")
        val teamId = teamId(teamCreate(owner, "Deferred Atlas", UUID.randomUUID().toString()).expectStatus(201))
        val creation = mockMvc.post("/api/public/rooms") {
            authorize(owner)
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Deferred personal room","language":"nodejs"}"""
        }.andReturn().expectStatus(200)
        val created = json(creation)
        val roomId = created.path("id").asText()
        val inviteCode = created.path("inviteCode").asText()
        val sessionId = "deferred-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", sessionId)
            param("displayName", "Deferred owner")
            authorize(owner)
        }.andReturn().expectStatus(200)
        val eventToken = realtimeEventToken(objectMapper, stream)
        val persistedBefore = roomMutationSnapshot(jdbcTemplate, roomId)
        val deferredCode = "must not cross into TEAM scope ${UUID.randomUUID()}"

        mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to sessionId,
                    "eventToken" to eventToken,
                    "operationId" to UUID.randomUUID().toString(),
                    "type" to "yjs_update",
                    "syncKey" to "$inviteCode:0:nodejs",
                    "yjsUpdate" to "AQ==",
                    "code" to deferredCode,
                    "yjsDocumentBase64" to "AQ==",
                    "yjsClientSequence" to 1,
                    "baseServerYjsSequence" to 0,
                ),
            )
        }.andReturn().expectStatus(204)
        jdbcTemplate.update("UPDATE rooms SET team_id = ?, origin_team_id = ? WHERE id = ?", teamId, teamId, roomId)

        Thread.sleep(1_000)

        assertEquals(persistedBefore, roomMutationSnapshot(jdbcTemplate, roomId), "delayed PERSONAL save must recheck canonical scope")
        assertEquals(null, collaborationService.resolveRoleByEventToken(inviteCode, eventToken), "scope transition must evict old runtime grants")
    }

    @Test
    fun `failed account deletion preflights team constraints without mutating personal rooms or realtime`() {
        val admin = registerPrimaryAdmin()
        val target = register("team-delete-target")
        teamCreate(target, "Owned team", UUID.randomUUID().toString()).expectStatus(201)
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, target, "Personal room survives blocked account delete")
        val sessionId = "delete-preflight-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId)
            param("displayName", "Delete target")
            authorize(target)
        }.andReturn().expectStatus(200)
        val eventToken = realtimeEventToken(objectMapper, stream)
        val persistedBefore = roomMutationSnapshot(jdbcTemplate, room.id)

        val denied = mockMvc.delete("/api/admin/users/${target.id}") {
            authorize(admin)
        }.andReturn().expectStatus(409)
        assertProtectedNoStore(denied)
        assertEquals(persistedBefore, roomMutationSnapshot(jdbcTemplate, room.id))
        assertEquals(1L, count("users", "id = ?", target.id))
        assertEquals(1L, count("rooms", "id = ? AND team_id IS NULL", room.id))

        mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to sessionId,
                    "eventToken" to eventToken,
                    "type" to "presence_update",
                    "presenceStatus" to "active",
                ),
            )
        }.andReturn().expectStatus(204)
        assertTrue(
            collaborationService.resolveRoleByEventToken(room.inviteCode, eventToken) != null,
            "failed account deletion must not disconnect an otherwise valid PERSONAL session",
        )
    }

    @Test
    fun `successful personal account deletion closes realtime only after database commit`() {
        val admin = register("del-admin")
        jdbcTemplate.update("UPDATE users SET role = 'admin' WHERE id = ?", admin.id)
        val target = register("del-target")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, target, "Personal room deleted with account")
        val sessionId = "delete-commit-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId)
            param("displayName", "Personal delete target")
            authorize(target)
        }.andReturn().expectStatus(200)
        val eventToken = realtimeEventToken(objectMapper, stream)
        assertTrue(
            collaborationService.resolveRoleByEventToken(room.inviteCode, eventToken) != null,
            "fixture must establish live PERSONAL runtime before deletion",
        )

        val deleted = mockMvc.delete("/api/admin/users/${target.id}") {
            authorize(admin)
        }.andReturn().expectStatus(200)
        assertEquals("ok", json(deleted).path("status").asText())
        assertEquals(0L, count("users", "id = ?", target.id), "successful response must follow committed user deletion")
        assertEquals(0L, count("rooms", "id = ?", room.id), "owned PERSONAL room must be deleted in the same commit")
        assertEquals(0L, count("user_sessions", "user_id = ?", target.id))

        // Reuse of the now-free invite code by an unrelated room makes a stale
        // in-memory connection externally observable without a test-only hook:
        // a missed afterCommit eviction would authorize the old token against
        // the replacement room's runtime namespace.
        val replacementOwner = register("del-control")
        val replacementRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, replacementOwner, "Replacement control room")
        jdbcTemplate.update("UPDATE rooms SET invite_code = ? WHERE id = ?", room.inviteCode, replacementRoom.id)
        assertEquals(1L, count("rooms", "id = ? AND invite_code = ?", replacementRoom.id, room.inviteCode))
        assertEquals(
            null,
            collaborationService.resolveRoleByEventToken(room.inviteCode, eventToken),
            "afterCommit must evict the deleted room runtime and its former event token",
        )
        val unavailableRelay = mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to sessionId,
                    "eventToken" to eventToken,
                    "type" to "presence_update",
                    "presenceStatus" to "active",
                ),
            )
        }.andReturn().expectStatus(403)
        assertNonDisclosingDenial(unavailableRelay, listOf(room.id, room.inviteCode, target.id, target.token, eventToken))
    }

    private fun register(prefix: String, isHr: Boolean = false): HrTestAccount =
        HrHttpFixtures.register(mockMvc, objectMapper, isHr, prefix).first

    private fun registerPrimaryAdmin(): HrTestAccount {
        val result = mockMvc.post("/api/auth/register") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "nickname" to "boumrz",
                    "displayName" to "Primary Admin",
                    "password" to "admin-secret",
                    "isHr" to false,
                ),
            )
        }.andReturn().expectStatus(200)
        val body = json(result)
        assertEquals("admin", body.path("user").path("role").asText())
        return HrTestAccount(body.path("user").path("id").asText(), body.path("token").asText())
    }

    private fun teamCreate(
        actor: HrTestAccount? = null,
        name: String = "Atlas",
        key: String? = UUID.randomUUID().toString(),
        rawBody: String? = null,
    ): MvcResult = mockMvc.post("/api/teams") {
        actor?.let(::authorize)
        key?.let { header("Idempotency-Key", it) }
        contentType = MediaType.APPLICATION_JSON
        content = rawBody ?: objectMapper.writeValueAsString(mapOf("name" to name))
    }.andReturn()

    private fun json(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)
    private fun teamId(result: MvcResult): String = json(result).path("team").path("id").asText()
    private fun safe404(result: MvcResult): List<String?> = listOf(
        result.response.status.toString(),
        result.response.contentAsString,
        result.response.getHeader("Cache-Control"),
        result.response.getHeader("Location"),
        result.response.getHeader("Retry-After"),
    )

    private fun assertExactCreateRows(actorId: String, teamId: String, key: String) {
        assertEquals(1L, count("teams", "id = ? AND owner_user_id = ?", teamId, actorId))
        val persistedRole = jdbcTemplate.queryForObject(
            "SELECT role FROM team_memberships WHERE team_id = ? AND user_id = ? AND state = 'ACTIVE'",
            String::class.java,
            teamId,
            actorId,
        )
        assertTrue(persistedRole in setOf("ADMIN", "MEMBER"), "persisted membership role must follow D2")
        assertEquals(
            1L,
            count(
                "teams t JOIN team_memberships m ON m.team_id=t.id AND m.user_id=t.owner_user_id",
                "t.id = ? AND t.owner_user_id = ? AND m.state = 'ACTIVE'",
                teamId,
                actorId,
            ),
            "effective OWNER is the unique team owner with one ACTIVE membership",
        )
        assertEquals(1L, count("team_audit_events", "team_id = ? AND actor_user_id = ? AND action = 'TEAM_CREATE'", teamId, actorId))
        assertEquals(
            1L,
            count(
                "command_receipts",
                "actor_user_id = ? AND scope_kind = 'PERSONAL' AND scope_id = ? AND operation = 'TEAM_CREATE' " +
                    "AND idempotency_key = ? AND status = 201 AND resource_id = ?",
                actorId,
                actorId,
                key,
                teamId,
            ),
        )
    }

    private fun assertReceiptCanonicalContract(actorId: String, key: String): String {
        val receipt = jdbcTemplate.queryForMap(
            """
            SELECT request_hash, EXTRACT(EPOCH FROM (expires_at - created_at)) AS ttl_seconds
            FROM command_receipts
            WHERE actor_user_id = ? AND scope_kind = 'PERSONAL' AND scope_id = ?
              AND operation = 'TEAM_CREATE' AND idempotency_key = ?
            """.trimIndent(),
            actorId,
            actorId,
            key,
        )
        val requestHash = receipt.getValue("request_hash").toString()
        assertTrue(
            Regex("^v1:[0-9a-f]{64}${'$'}").matches(requestHash),
            "request_hash must identify canonical format v1 and contain its SHA-256 digest",
        )
        assertEquals(86_400L, (receipt.getValue("ttl_seconds") as Number).toLong(), "receipt TTL must be exactly 24 hours")
        return requestHash
    }

    private fun assertReceiptStoragePrivacy(actorId: String, teamId: String, key: String, forbiddenValues: List<String>) {
        val forbiddenColumn = jdbcTemplate.queryForList(
            """
            SELECT table_name,column_name FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name IN ('command_receipts','team_audit_events')
              AND column_name ~* '(response|payload|body|name|nickname|login|email|token|candidate|task|chat)'
            """.trimIndent(),
        )
        assertTrue(forbiddenColumn.isEmpty(), "receipt/audit schema must not retain response or private payload columns: $forbiddenColumn")
        val receiptJson = jdbcTemplate.queryForObject(
            """
            SELECT row_to_json(receipt)::text FROM command_receipts receipt
            WHERE actor_user_id=? AND scope_kind='PERSONAL' AND scope_id=?
              AND operation='TEAM_CREATE' AND idempotency_key=?
            """.trimIndent(),
            String::class.java,
            actorId,
            actorId,
            key,
        ).orEmpty()
        val auditJson = jdbcTemplate.queryForObject(
            "SELECT row_to_json(event)::text FROM team_audit_events event WHERE team_id=? AND actor_user_id=? AND action='TEAM_CREATE'",
            String::class.java,
            teamId,
            actorId,
        ).orEmpty()
        forbiddenValues.forEach { forbidden ->
            assertFalse(receiptJson.contains(forbidden), "terminal receipt retained private request/credential data")
            assertFalse(auditJson.contains(forbidden), "audit retained private request/credential data")
        }
        assertTrue(receiptJson.contains(teamId), "safe outcome must be reconstructable from resourceId")
    }

    private fun assertSafeCommandOutcome(result: MvcResult, teamId: String) {
        assertProtectedNoStore(result)
        val body = json(result)
        assertEquals("CREATED", body.path("outcome").asText())
        assertEquals(201, body.path("status").asInt())
        assertEquals(teamId, body.path("resourceId").asText())
        assertNoPrivateFields(result.response.contentAsString)
        assertFalse(result.response.contentAsString.contains("Atlas"), "command inspection must not replay the private create payload")
    }

    private fun tableExists(table: String): Boolean = jdbcTemplate.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?)",
        Boolean::class.java,
        table,
    ) ?: false

    private fun count(table: String, where: String? = null, vararg args: Any): Long {
        val sql = "SELECT COUNT(*) FROM $table" + if (where == null) "" else " WHERE $where"
        return jdbcTemplate.queryForObject(sql, Long::class.java, *args) ?: 0L
    }
}

@SpringBootTest(properties = ["app.features.team-workspaces-enabled=false"])
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamLegacyConfigurationIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_feature_off")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `legacy false configuration permits create while authorized reads and personal predicates stay safe`() {
        val actor = HrHttpFixtures.register(mockMvc, objectMapper, true, "team-disabled").first
        val personalRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, actor, "Personal alongside legacy configuration")
        val key = UUID.randomUUID().toString()
        val result = mockMvc.post("/api/teams") {
            authorize(actor)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Atlas"}"""
        }.andReturn().expectStatus(201)
        assertProtectedNoStore(result)
        assertNoPrivateFields(result.response.contentAsString)
        assertEquals(1L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM teams WHERE owner_user_id = ?", Long::class.java, actor.id) ?: -1L)
        assertEquals(
            1L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM command_receipts WHERE actor_user_id = ? AND idempotency_key = ?",
                Long::class.java,
                actor.id,
                key,
            ) ?: -1L,
        )
        val teamId = seedExistingTeam(jdbcTemplate, actor.id, "Existing legacy Atlas")
        val workspaces = mockMvc.get("/api/me/workspaces") { authorize(actor) }.andReturn().expectStatus(200)
        assertProtectedNoStore(workspaces)
        assertTrue(workspaces.response.contentAsString.contains(teamId))
        assertNoPrivateFields(workspaces.response.contentAsString)
        val detail = mockMvc.get("/api/teams/$teamId") { authorize(actor) }.andReturn().expectStatus(200)
        assertProtectedNoStore(detail)
        assertNoPrivateFields(detail.response.contentAsString)
        val stranger = HrHttpFixtures.register(mockMvc, objectMapper, false, "flag-stranger").first
        val denied = mockMvc.get("/api/teams/$teamId") { authorize(stranger) }.andReturn()
            .expectStatusAndCode(404, "TEAM_NOT_FOUND")
        assertNonDisclosingDenial(denied, listOf(teamId, actor.id, actor.token, "Existing legacy Atlas"))
        val personalRooms = mockMvc.get("/api/me/rooms") { authorize(actor) }.andReturn().expectStatus(200)
        assertTrue(personalRooms.response.contentAsString.contains(personalRoom.id))
        assertFalse(personalRooms.response.contentAsString.contains(teamId))
        val teamRoom = prepareLegacyTeamRoom(mockMvc, objectMapper, jdbcTemplate, actor, teamId, "off")
        assertLegacyTeamRoomIsolation(mockMvc, objectMapper, jdbcTemplate, actor, personalRoom, teamRoom)
        val unauthenticatedWorkspace = mockMvc.get("/api/me/workspaces").andReturn().expectStatus(401)
        assertNonDisclosingDenial(unauthenticatedWorkspace, listOf(teamId, teamRoom.room.id, teamRoom.room.inviteCode))
    }
}

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamDefaultConfigurationIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_feature_default")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `create is available by default without weakening personal scope`() {
        val actor = HrHttpFixtures.register(mockMvc, objectMapper, true, "team-default").first
        val personalRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, actor, "Personal under default configuration")
        val key = UUID.randomUUID().toString()
        val result = mockMvc.post("/api/teams") {
            authorize(actor)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Atlas"}"""
        }.andReturn().expectStatus(201)
        assertProtectedNoStore(result)
        assertNoPrivateFields(result.response.contentAsString)
        assertEquals(1L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM teams WHERE owner_user_id = ?", Long::class.java, actor.id) ?: -1L)
        assertEquals(
            1L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM command_receipts WHERE actor_user_id = ? AND idempotency_key = ?",
                Long::class.java,
                actor.id,
                key,
            ) ?: -1L,
        )
        val teamId = seedExistingTeam(jdbcTemplate, actor.id, "Existing default Atlas")
        val workspaces = mockMvc.get("/api/me/workspaces") { authorize(actor) }.andReturn().expectStatus(200)
        assertProtectedNoStore(workspaces)
        assertTrue(workspaces.response.contentAsString.contains(teamId))
        assertNoPrivateFields(workspaces.response.contentAsString)
        val detail = mockMvc.get("/api/teams/$teamId") { authorize(actor) }.andReturn().expectStatus(200)
        assertProtectedNoStore(detail)
        assertNoPrivateFields(detail.response.contentAsString)
        val stranger = HrHttpFixtures.register(mockMvc, objectMapper, false, "default-foreign").first
        val denied = mockMvc.get("/api/teams/$teamId") { authorize(stranger) }.andReturn()
            .expectStatusAndCode(404, "TEAM_NOT_FOUND")
        assertNonDisclosingDenial(denied, listOf(teamId, actor.id, actor.token, "Existing default Atlas"))
        val personalRooms = mockMvc.get("/api/me/rooms") { authorize(actor) }.andReturn().expectStatus(200)
        assertTrue(personalRooms.response.contentAsString.contains(personalRoom.id))
        assertFalse(personalRooms.response.contentAsString.contains(teamId))
        val teamRoom = prepareLegacyTeamRoom(mockMvc, objectMapper, jdbcTemplate, actor, teamId, "default")
        assertLegacyTeamRoomIsolation(mockMvc, objectMapper, jdbcTemplate, actor, personalRoom, teamRoom)
        val unauthenticatedWorkspace = mockMvc.get("/api/me/workspaces").andReturn().expectStatus(401)
        assertNonDisclosingDenial(unauthenticatedWorkspace, listOf(teamId, teamRoom.room.id, teamRoom.room.inviteCode))
    }
}

class TeamCreateRestartHttpIntegrationTest {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_restart_http")

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    private val objectMapper = ObjectMapper()
    private val http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()

    @Test
    fun `terminal create and command inspection survive a real Spring HTTP restart on the same PostgreSQL schema`() {
        postgres.verifyPostgres16()
        val key = UUID.randomUUID().toString()
        var application = startApplication()
        val first: HttpResult
        val commandBeforeRestart: HttpResult
        val token: String
        val actorId: String
        val teamId: String
        try {
            val port = applicationPort(application)
            val suffix = UUID.randomUUID().toString().replace("-", "").take(8)
            val registration = postJson(
                port,
                "/api/auth/register",
                """{"nickname":"restart-$suffix","displayName":"Restart $suffix","password":"secret-$suffix","isHr":false}""",
            )
            assertEquals(200, registration.status, registration.bodyText())
            val registrationJson = objectMapper.readTree(registration.body)
            token = registrationJson.path("token").asText()
            actorId = registrationJson.path("user").path("id").asText()
            first = postJson(
                port,
                "/api/teams",
                """{"name":"  Atlas  "}""",
                token,
                key,
            )
            assertEquals(201, first.status, first.bodyText())
            assertHttpNoStore(first)
            teamId = objectMapper.readTree(first.body).path("team").path("id").asText()
            assertEquals("/api/teams/$teamId", first.location())
            commandBeforeRestart = get(
                port,
                "/api/me/commands/$key?scope=personal&operation=TEAM_CREATE",
                token,
            )
            assertHttpCommandOutcome(commandBeforeRestart, teamId)
        } finally {
            application.close()
        }

        application = startApplication()
        try {
            val port = applicationPort(application)
            val replay = postJson(
                port,
                "/api/teams",
                """{"name":"\u3000Ａtlas\u3000"}""",
                token,
                key,
            )
            assertEquals(201, replay.status, replay.bodyText())
            assertHttpNoStore(replay)
            assertEquals(first.body.toList(), replay.body.toList(), "restart replay body must be byte-equivalent")
            assertEquals(first.location(), replay.location(), "restart replay must preserve Location")
            val commandAfterRestart = get(
                port,
                "/api/me/commands/$key?scope=personal&operation=TEAM_CREATE",
                token,
            )
            assertHttpCommandOutcome(commandAfterRestart, teamId)
            assertEquals(
                commandBeforeRestart.body.toList(),
                commandAfterRestart.body.toList(),
                "safe command inspection must be stable across restart",
            )
            assertHttpPersistedCreateRows(actorId, teamId, key)
        } finally {
            application.close()
        }
    }

    @Test
    fun `critical auth foreign access and twenty way idempotency use real HTTP and PostgreSQL`() {
        var application = startApplication()
        try {
            val port = applicationPort(application)
            val unknownTeamId = UUID.randomUUID().toString()
            val unknownKey = UUID.randomUUID().toString()
            listOf(
                get(port, "/api/me/workspaces"),
                get(port, "/api/teams/$unknownTeamId"),
                get(port, "/api/me/commands/$unknownKey?scope=personal&operation=TEAM_CREATE"),
                postJson(port, "/api/teams", """{"name":"No auth"}""", idempotencyKey = UUID.randomUUID().toString()),
            ).forEach { denial ->
                assertEquals(401, denial.status, denial.bodyText())
                assertHttpDenial(denial, listOf(unknownTeamId, unknownKey, "No auth"))
            }

            val owner = registerHttp(port, "http-owner")
            val stranger = registerHttp(port, "http-stranger")
            val privateCreate = postJson(
                port,
                "/api/teams",
                """{"name":"Private Atlas"}""",
                owner.token,
                UUID.randomUUID().toString(),
            )
            assertEquals(201, privateCreate.status, privateCreate.bodyText())
            val privateTeamId = objectMapper.readTree(privateCreate.body).path("team").path("id").asText()
            val foreign = get(port, "/api/teams/$privateTeamId", stranger.token)
            assertEquals(404, foreign.status, foreign.bodyText())
            assertHttpDenial(foreign, listOf(privateTeamId, "Private Atlas", owner.id, owner.token))

            val concurrentActor = registerHttp(port, "http-race")
            val key = UUID.randomUUID().toString()
            val ready = CountDownLatch(20)
            val release = CountDownLatch(1)
            val executor = Executors.newFixedThreadPool(20)
            val futures = (1..20).map {
                executor.submit(Callable {
                    ready.countDown()
                    release.await(10, TimeUnit.SECONDS)
                    postJson(port, "/api/teams", """{"name":"Concurrent Orbit"}""", concurrentActor.token, key)
                })
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS))
            release.countDown()
            val results = try {
                futures.map { it.get(20, TimeUnit.SECONDS) }
            } finally {
                executor.shutdownNow()
            }
            results.forEach { assertEquals(201, it.status, it.bodyText()); assertHttpNoStore(it) }
            assertEquals(1, results.map { it.body.toList() }.toSet().size)
            assertEquals(1, results.map { it.location() }.toSet().size)
            val teamId = objectMapper.readTree(results.first().body).path("team").path("id").asText()
            assertHttpPersistedCreateRows(concurrentActor.id, teamId, key)
        } finally {
            application.close()
        }
    }

    private fun startApplication(): ConfigurableApplicationContext =
        SpringApplicationBuilder(InterviewOnlineApplication::class.java)
            .web(WebApplicationType.SERVLET)
            .run(
                *(postgres.applicationProperties() + mapOf(
                    "server.port" to 0,
                    "app.team-invitation-link-encryption.active-key-id" to "integration-v1",
                    "app.team-invitation-link-encryption.keys.integration-v1" to "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                    "spring.main.banner-mode" to "off",
                )).map { (name, value) -> "--$name=$value" }.toTypedArray(),
            )

    private fun applicationPort(application: ConfigurableApplicationContext): Int =
        application.environment.getRequiredProperty("local.server.port").toInt()

    private fun postJson(
        port: Int,
        path: String,
        body: String,
        token: String? = null,
        idempotencyKey: String? = null,
    ): HttpResult {
        val builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .POST(HttpRequest.BodyPublishers.ofString(body))
        token?.let { builder.header("Authorization", "Bearer $it") }
        idempotencyKey?.let { builder.header("Idempotency-Key", it) }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray()).toResult()
    }

    private fun get(port: Int, path: String, token: String? = null): HttpResult {
        val builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).GET()
        token?.let { builder.header("Authorization", "Bearer $it") }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray()).toResult()
    }

    private fun registerHttp(port: Int, prefix: String): HttpAccount {
        val suffix = UUID.randomUUID().toString().replace("-", "").take(8)
        val registration = postJson(
            port,
            "/api/auth/register",
            """{"nickname":"$prefix-$suffix","displayName":"$prefix $suffix","password":"secret-$suffix","isHr":false}""",
        )
        assertEquals(200, registration.status, registration.bodyText())
        val body = objectMapper.readTree(registration.body)
        return HttpAccount(body.path("user").path("id").asText(), body.path("token").asText())
    }

    private fun assertHttpPersistedCreateRows(actorId: String, teamId: String, key: String) {
        postgres.connection().use { connection ->
            assertEquals(1L, sqlCount(connection, "teams", "owner_user_id=?", actorId))
            assertEquals(
                1L,
                sqlCount(
                    connection,
                    "team_memberships membership JOIN teams team ON team.id=membership.team_id",
                    "team.owner_user_id=? AND membership.user_id=?",
                    actorId,
                    actorId,
                ),
            )
            assertEquals(1L, sqlCount(connection, "team_audit_events", "actor_user_id=? AND action='TEAM_CREATE'", actorId))
            assertEquals(
                1L,
                sqlCount(
                    connection,
                    "command_receipts",
                    "actor_user_id=? AND scope_kind='PERSONAL' AND scope_id=? AND operation='TEAM_CREATE'",
                    actorId,
                    actorId,
                ),
            )
            assertEquals(1L, sqlCount(connection, "teams", "id=? AND owner_user_id=?", teamId, actorId))
            assertEquals(
                1L,
                sqlCount(connection, "team_memberships", "team_id=? AND user_id=? AND state='ACTIVE' AND role IN ('ADMIN','MEMBER')", teamId, actorId),
            )
            assertEquals(1L, sqlCount(connection, "team_audit_events", "team_id=? AND actor_user_id=? AND action='TEAM_CREATE'", teamId, actorId))
            assertEquals(
                1L,
                sqlCount(
                    connection,
                    "command_receipts",
                    "actor_user_id=? AND scope_kind='PERSONAL' AND scope_id=? AND operation='TEAM_CREATE' " +
                        "AND idempotency_key=? AND status=201 AND resource_id=?",
                    actorId,
                    actorId,
                    key,
                    teamId,
                ),
            )
            assertEquals(
                0L,
                sqlCount(
                    connection,
                    "command_receipts receipt LEFT JOIN teams team ON team.id=receipt.resource_id",
                    "receipt.actor_user_id=? AND receipt.scope_id=? AND receipt.idempotency_key=? AND team.id IS NULL",
                    actorId,
                    actorId,
                    key,
                ),
                "actor/key namespace must have no orphan terminal receipt",
            )
        }
    }

    private fun sqlCount(connection: java.sql.Connection, from: String, where: String, vararg args: String): Long =
        connection.prepareStatement("SELECT COUNT(*) FROM $from WHERE $where").use { statement ->
            args.forEachIndexed { index, value -> statement.setString(index + 1, value) }
            statement.executeQuery().use { result -> result.next(); result.getLong(1) }
        }

    private fun assertHttpDenial(result: HttpResult, forbiddenValues: List<String>) {
        assertHttpNoStore(result)
        assertEquals(null, result.location())
        assertEquals(null, result.headers.firstValue("Retry-After").orElse(null))
        assertNoPrivateFields(result.bodyText())
        forbiddenValues.forEach { assertFalse(result.bodyText().contains(it), "HTTP denial disclosed protected fixture value") }
    }

    private fun assertHttpCommandOutcome(result: HttpResult, teamId: String) {
        assertEquals(200, result.status, result.bodyText())
        assertHttpNoStore(result)
        val body = objectMapper.readTree(result.body)
        assertEquals("CREATED", body.path("outcome").asText())
        assertEquals(201, body.path("status").asInt())
        assertEquals(teamId, body.path("resourceId").asText())
        assertNoPrivateFields(result.bodyText())
        assertFalse(result.bodyText().contains("Atlas"), "inspection must not store or replay the private create body")
    }

    private fun assertHttpNoStore(result: HttpResult) {
        assertTrue(result.cacheControl().contains("no-store"), "protected HTTP response must use Cache-Control: no-store")
    }
}

private data class HttpAccount(val id: String, val token: String)

private data class HttpResult(
    val status: Int,
    val body: ByteArray,
    val headers: java.net.http.HttpHeaders,
) {
    fun bodyText(): String = body.toString(Charsets.UTF_8)
    fun location(): String? = headers.firstValue("Location").orElse(null)
    fun cacheControl(): String = headers.firstValue("Cache-Control").orElse("")
}

private fun HttpResponse<ByteArray>.toResult(): HttpResult = HttpResult(statusCode(), body(), headers())

private fun seedExistingTeam(jdbcTemplate: JdbcTemplate, ownerId: String, name: String): String {
    val teamId = UUID.randomUUID().toString()
    jdbcTemplate.update(
        """
        INSERT INTO teams
            (id,name,normalized_name,owner_user_id,state,revision,security_revision,merge_revision,created_at,updated_at)
        VALUES (?,?,?,?,'ACTIVE',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        """.trimIndent(),
        teamId,
        name,
        name.lowercase(),
        ownerId,
    )
    jdbcTemplate.update(
        """
        INSERT INTO team_memberships
            (id,team_id,user_id,role,state,epoch,revision,created_at,updated_at)
        VALUES (?,?,?,'ADMIN','ACTIVE',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        """.trimIndent(),
        UUID.randomUUID().toString(),
        teamId,
        ownerId,
    )
    return teamId
}

private data class LegacyTeamRoomFixture(
    val room: HrTestRoom,
    val candidate: HrTestAccount,
    val ownerToken: String,
    val interviewerToken: String,
    val eventSessionId: String,
    val eventToken: String,
    val persistedBeforeDenials: Map<String, Any?>,
    val persistedEventCountBeforeDenials: Long,
)

private fun prepareLegacyTeamRoom(
    mockMvc: MockMvc,
    objectMapper: ObjectMapper,
    jdbcTemplate: JdbcTemplate,
    owner: HrTestAccount,
    teamId: String,
    prefix: String,
): LegacyTeamRoomFixture {
    val candidate = HrHttpFixtures.register(mockMvc, objectMapper, false, "${prefix.take(8)}-candidate").first
    val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "$prefix TEAM room")
    jdbcTemplate.update(
        """
        INSERT INTO room_participants(id,room_id,user_id,role,created_at)
        VALUES (?,?,?,'candidate',CURRENT_TIMESTAMP)
        """.trimIndent(),
        UUID.randomUUID().toString(),
        room.id,
        candidate.id,
    )
    val sessionId = "$prefix-${UUID.randomUUID()}"
    val stream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
        param("sessionId", sessionId)
        param("displayName", "$prefix owner")
        authorize(owner)
    }.andReturn().expectStatus(200)
    val eventToken = stream.response.contentAsString.lineSequence()
        .filter { it.startsWith("data:") }
        .map { objectMapper.readTree(it.removePrefix("data:")) }
        .filter { it.path("type").asText() == "state_sync" }
        .last().path("payload").path("eventToken").asText()
    assertTrue(eventToken.startsWith("evt_"), "fixture must obtain a real pre-team realtime eventToken")
    val tokens = jdbcTemplate.queryForMap(
        "SELECT owner_session_token, interviewer_session_token FROM rooms WHERE id = ?",
        room.id,
    )
    val ownerToken = tokens.getValue("owner_session_token").toString()
    val interviewerToken = tokens.getValue("interviewer_session_token").toString()
    val persisted = roomMutationSnapshot(jdbcTemplate, room.id)
    val persistedEvents = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM room_keystroke_events WHERE room_id = ?",
        Long::class.java,
        room.id,
    ) ?: 0L
    jdbcTemplate.update("UPDATE rooms SET team_id = ?, origin_team_id = ? WHERE id = ?", teamId, teamId, room.id)
    return LegacyTeamRoomFixture(room, candidate, ownerToken, interviewerToken, sessionId, eventToken, persisted, persistedEvents)
}

private fun assertLegacyTeamRoomIsolation(
    mockMvc: MockMvc,
    objectMapper: ObjectMapper,
    jdbcTemplate: JdbcTemplate,
    owner: HrTestAccount,
    personalControl: HrTestRoom,
    fixture: LegacyTeamRoomFixture,
) {
    val room = fixture.room
    val personal = mockMvc.get("/api/me/rooms") { authorize(owner) }.andReturn().expectStatus(200)
    assertTrue(personal.response.contentAsString.contains(personalControl.id))
    assertFalse(personal.response.contentAsString.contains(room.id))
    assertFalse(personal.response.contentAsString.contains(room.inviteCode))
    val hrList = mockMvc.get("/api/me/hr/rooms") { authorize(owner) }.andReturn().expectStatus(200)
    assertFalse(hrList.response.contentAsString.contains(room.id))
    assertFalse(hrList.response.contentAsString.contains(room.inviteCode))

    val deniedTeamTitle = "TEAM title must not persist"
    val participantPatch = mockMvc.patch("/api/me/rooms/${room.id}") {
        authorize(fixture.candidate)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("title" to deniedTeamTitle))
    }.andReturn()
    val participantDelete = mockMvc.delete("/api/me/rooms/${room.id}") {
        authorize(fixture.candidate)
    }.andReturn()
    val ownerPatch = mockMvc.patch("/api/me/rooms/${room.id}") {
        authorize(owner)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("title" to deniedTeamTitle))
    }.andReturn()
    val ownerDelete = mockMvc.delete("/api/me/rooms/${room.id}") {
        authorize(owner)
    }.andReturn()
    val unknownRoomId = UUID.randomUUID().toString()
    val unknownPatch = mockMvc.patch("/api/me/rooms/$unknownRoomId") {
        authorize(owner)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("title" to deniedTeamTitle))
    }.andReturn().expectStatus(404)
    val unknownDelete = mockMvc.delete("/api/me/rooms/$unknownRoomId") {
        authorize(owner)
    }.andReturn().expectStatus(404)

    assertEquals(1L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE id = ?", Long::class.java, room.id))
    assertEquals(fixture.persistedBeforeDenials, roomMutationSnapshot(jdbcTemplate, room.id))
    listOf(ownerPatch, participantPatch).forEach { denial ->
        denial.expectStatus(404)
        assertEquals(safeUnavailable(unknownPatch), safeUnavailable(denial), "TEAM and unknown PATCH must be indistinguishable")
    }
    listOf(ownerDelete, participantDelete).forEach { denial ->
        denial.expectStatus(404)
        assertEquals(safeUnavailable(unknownDelete), safeUnavailable(denial), "TEAM and unknown DELETE must be indistinguishable")
    }

    listOf(
        mockMvc.get("/api/rooms/${room.inviteCode}") { authorize(owner) }.andReturn().expectStatus(200),
        mockMvc.get("/api/rooms/${room.inviteCode}") { header("X-Room-Owner-Token", fixture.ownerToken) }.andReturn().expectStatus(200),
        mockMvc.get("/api/rooms/${room.inviteCode}") { header("X-Room-Interviewer-Token", fixture.interviewerToken) }.andReturn().expectStatus(200),
        mockMvc.get("/api/rooms/${room.inviteCode}") { authorize(fixture.candidate) }.andReturn().expectStatus(200),
    ).forEach { admission ->
        val body = objectMapper.readTree(admission.response.contentAsString)
        assertEquals("candidate", body.path("role").asText())
        assertFalse(body.path("canManageRoom").asBoolean())
        assertEquals(0, body.path("accessMembers").size())
        assertEquals(0, body.path("notesMessages").size())
        assertFalse(admission.response.contentAsString.contains(fixture.ownerToken))
        assertFalse(admission.response.contentAsString.contains(fixture.interviewerToken))
    }
    mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream-status") {
        param("ownerToken", fixture.ownerToken)
    }.andReturn().expectStatus(204)
    val publicStream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
        param("sessionId", "public-${UUID.randomUUID()}")
        param("authToken", owner.token)
    }.andReturn().expectStatus(200)
    val payload = publicStream.response.contentAsString.lineSequence()
        .filter { it.startsWith("data:") }
        .map { objectMapper.readTree(it.removePrefix("data:")) }
        .last { it.path("type").asText() == "state_sync" }.path("payload")
    assertEquals("candidate", payload.path("role").asText())
    assertEquals(0, payload.path("notesMessages").size())
    assertEquals(0, payload.path("personalNotes").size())

    val denials = listOf(
        mockMvc.get("/api/me/hr/rooms/${room.id}") { authorize(owner) }.andReturn().expectStatus(404),
        mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to fixture.eventSessionId,
                    "eventToken" to fixture.eventToken,
                    "type" to "code_update",
                    "code" to "must-not-persist",
                    "codeSequence" to 1,
                ),
            )
        }.andReturn().expectStatus(403),
        mockMvc.post("/api/rooms/${room.inviteCode}/next-step") {
            header("X-Room-Owner-Token", fixture.ownerToken)
        }.andReturn().expectStatus(403),
        mockMvc.post("/api/rooms/${room.inviteCode}/participants/${fixture.candidate.id}/role") {
            authorize(owner)
            contentType = MediaType.APPLICATION_JSON
            content = """{"role":"interviewer"}"""
        }.andReturn().expectStatus(403),
    )
    val unknown = mockMvc.get("/api/rooms/missing-${UUID.randomUUID()}") { authorize(owner) }
        .andReturn().expectStatus(404)
    val secrets = listOf(
        room.id,
        room.inviteCode,
        fixture.ownerToken,
        fixture.interviewerToken,
        fixture.eventToken,
        "must-not-persist",
        deniedTeamTitle,
    )
    (denials + unknown + ownerPatch + participantPatch + ownerDelete + participantDelete + unknownPatch + unknownDelete)
        .forEach { assertNonDisclosingDenial(it, secrets) }
    assertEquals(fixture.persistedBeforeDenials, roomMutationSnapshot(jdbcTemplate, room.id))
    assertEquals(
        fixture.persistedEventCountBeforeDenials,
        jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_keystroke_events WHERE room_id = ?", Long::class.java, room.id) ?: -1L,
    )

    assertArchivedLegacyTeamMutations(mockMvc, objectMapper, jdbcTemplate, owner, fixture)

    val personalTitle = "Personal mutation remains available ${UUID.randomUUID()}"
    val personalPatch = mockMvc.patch("/api/me/rooms/${personalControl.id}") {
        authorize(owner)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("title" to personalTitle))
    }.andReturn().expectStatus(200)
    assertEquals(personalTitle, objectMapper.readTree(personalPatch.response.contentAsString).path("title").asText())
    val personalDelete = mockMvc.delete("/api/me/rooms/${personalControl.id}") {
        authorize(owner)
    }.andReturn().expectStatus(200)
    assertEquals("ok", objectMapper.readTree(personalDelete.response.contentAsString).path("status").asText())
}

private fun assertArchivedLegacyTeamMutations(
    mockMvc: MockMvc,
    objectMapper: ObjectMapper,
    jdbcTemplate: JdbcTemplate,
    owner: HrTestAccount,
    fixture: LegacyTeamRoomFixture,
) {
    val room = fixture.room
    jdbcTemplate.update("UPDATE rooms SET archived_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id = ?", room.id)
    val archivedBefore = roomMutationSnapshot(jdbcTemplate, room.id)
    val revision = jdbcTemplate.queryForObject(
        "SELECT interview_metadata_revision FROM rooms WHERE id = ?",
        Long::class.java,
        room.id,
    ) ?: 0L
    val deniedWorkspaceCode = "archived TEAM workspace must not persist"
    val deniedCandidateName = "archived TEAM candidate must not persist"

    fun workspace(inviteCode: String) = mockMvc.put("/api/rooms/$inviteCode/tasks/0/workspace") {
        authorize(owner)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("code" to deniedWorkspaceCode, "revision" to 0))
    }.andReturn()
    fun metadata(inviteCode: String) = mockMvc.put("/api/rooms/$inviteCode/interview-metadata") {
        authorize(owner)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(
            mapOf(
                "candidateName" to deniedCandidateName,
                "position" to null,
                "scheduledAt" to null,
                "revision" to revision,
            ),
        )
    }.andReturn()
    fun invite(inviteCode: String) = mockMvc.put("/api/rooms/$inviteCode/hr-managers/${fixture.candidate.id}") {
        authorize(owner)
    }.andReturn()
    fun remove(inviteCode: String) = mockMvc.delete("/api/rooms/$inviteCode/hr-managers/${fixture.candidate.id}") {
        authorize(owner)
    }.andReturn()
    fun track(inviteCode: String) = mockMvc.post("/api/rooms/$inviteCode/hr-tracking") {
        authorize(owner)
    }.andReturn()

    val unknownInvite = "missing-${UUID.randomUUID()}"
    val known = listOf(
        workspace(room.inviteCode),
        metadata(room.inviteCode),
        invite(room.inviteCode),
        remove(room.inviteCode),
        track(room.inviteCode),
    )
    val unknown = listOf(
        workspace(unknownInvite).expectStatus(404),
        metadata(unknownInvite).expectStatus(404),
        invite(unknownInvite).expectStatus(404),
        remove(unknownInvite).expectStatus(404),
        track(unknownInvite).expectStatus(404),
    )
    assertEquals(archivedBefore, roomMutationSnapshot(jdbcTemplate, room.id), "archived TEAM legacy denials must be side-effect free")
    known.zip(unknown).forEachIndexed { index, (teamDenial, unknownDenial) ->
        val expectedStatus = if (index in 1..3) 410 else 404
        teamDenial.expectStatus(expectedStatus)
        if (expectedStatus == 404) {
            assertEquals(
                safeUnavailable(unknownDenial),
                safeUnavailable(teamDenial),
                "archived TEAM and unknown legacy mutations must be indistinguishable",
            )
        } else {
            assertEquals("GONE", objectMapper.readTree(teamDenial.response.contentAsString).path("code").asText())
        }
    }
    val forbidden = listOf(
        room.id,
        room.inviteCode,
        fixture.ownerToken,
        fixture.interviewerToken,
        fixture.eventToken,
        deniedWorkspaceCode,
        deniedCandidateName,
    )
    (known + unknown).forEach { assertNonDisclosingDenial(it, forbidden) }
}

private fun roomMutationSnapshot(jdbcTemplate: JdbcTemplate, roomId: String): Map<String, Any?> {
    val room = jdbcTemplate.queryForMap(
        "SELECT title,archived_at,status,code,current_step,notes,interviewer_chat,private_notes_json FROM rooms WHERE id = ?",
        roomId,
    )
    val taskWorkspaces = jdbcTemplate.queryForList(
        """
        SELECT id,solution_code,workspace_yjs_document_base64,workspace_yjs_sequence
        FROM room_tasks WHERE room_id = ? ORDER BY id
        """.trimIndent(),
        roomId,
    )
    return room + mapOf("task_workspaces" to taskWorkspaces)
}

private fun realtimeEventToken(objectMapper: ObjectMapper, stream: MvcResult): String {
    val eventToken = stream.response.contentAsString.lineSequence()
        .filter { it.startsWith("data:") }
        .map { objectMapper.readTree(it.removePrefix("data:")) }
        .filter { it.path("type").asText() == "state_sync" }
        .last().path("payload").path("eventToken").asText()
    assertTrue(eventToken.startsWith("evt_"), "fixture must obtain a real realtime eventToken")
    return eventToken
}

private fun safeUnavailable(result: MvcResult): List<String?> = listOf(
    result.response.status.toString(),
    result.response.contentAsString,
    result.response.getHeader("Cache-Control"),
    result.response.getHeader("Location"),
    result.response.getHeader("Retry-After"),
)

private fun assertNonDisclosingDenial(result: MvcResult, forbiddenValues: List<String>) {
    assertProtectedNoStore(result)
    assertNoPrivateFields(result.response.contentAsString)
    assertEquals(null, result.response.getHeader("Location"))
    assertEquals(null, result.response.getHeader("Retry-After"))
    forbiddenValues.filter { it.isNotBlank() }.forEach { forbidden ->
        assertFalse(result.response.contentAsString.contains(forbidden), "denial disclosed protected fixture value")
    }
    if (result.response.contentAsString.isNotBlank()) {
        val body = runCatching { ObjectMapper().readTree(result.response.contentAsString) }.getOrNull()
        assertTrue(body != null && body.hasNonNull("error") && body.hasNonNull("code"), "JSON denial needs a safe error/code envelope")
    }
}

private fun assertProtectedNoStore(result: MvcResult) {
    assertTrue(
        result.response.getHeader("Cache-Control").orEmpty().contains("no-store"),
        "protected response must use Cache-Control: no-store",
    )
}

private fun assertCacheControlDirectives(result: MvcResult, vararg expected: String) {
    val directives = result.response.getHeader("Cache-Control").orEmpty()
        .split(',')
        .map { it.trim().lowercase() }
        .toSet()
    expected.forEach { directive ->
        assertTrue(directive.lowercase() in directives, "Cache-Control must contain $directive; found $directives")
    }
}

private fun assertNoPrivateFields(body: String) {
    val privateField = Regex("\"([^\"]+)\"\\s*:").findAll(body)
        .map { it.groupValues[1] }
        .firstOrNull { field ->
            val normalized = field.lowercase()
            normalized in setOf("nickname", "login", "email", "token") ||
                normalized.contains("candidate") ||
                normalized.contains("foreign") ||
                normalized.endsWith("count") ||
                normalized.endsWith("counts") ||
                normalized.startsWith("total")
        }
    assertEquals(null, privateField, "protected team projection leaked private or foreign aggregate field '$privateField'")
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}

private fun MvcResult.expectStatus(expected: Int): MvcResult = apply {
    assertEquals(expected, response.status, response.contentAsString)
}

private fun MvcResult.expectStatusAndCode(expectedStatus: Int, expectedCode: String): MvcResult = apply {
    expectStatus(expectedStatus)
    assertTrue(
        response.contentAsString.contains("\"code\":\"$expectedCode\""),
        "Expected $expectedCode in ${response.contentAsString}",
    )
}
