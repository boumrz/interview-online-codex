package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.put
import org.springframework.test.web.servlet.delete
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.RoomTaskRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.service.RoomAccessService.RoomRole
import com.interviewonline.ws.RealtimeEventRequest
import org.springframework.test.util.AopTestUtils
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@AutoConfigureMockMvc
class HrRoomTrackingIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val participantRepository: RoomParticipantRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val roomTaskRepository: RoomTaskRepository,
    @Autowired private val assignmentRepository: RoomHrAssignmentRepository,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    @Test
    fun `authenticated creation assigns canonical hiring managers once and reconnect restores interviewer authority`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "creation-owner")
        val (firstManager, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "creation-first")
        val (secondManager, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "creation-second")

        mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Совместимая комната",
                "language" to "nodejs",
                "taskIds" to emptyList<String>(),
            ))
        }.andExpect { status { isOk() } }

        val created = mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Комната с нанимающими",
                "language" to "nodejs",
                "taskIds" to emptyList<String>(),
                "hiringManagerIds" to listOf(
                    " ${firstManager.id.uppercase()} ",
                    firstManager.id,
                    secondManager.id,
                ),
            ))
        }.andExpect { status { isOk() } }.andReturn()
        val roomNode = objectMapper.readTree(created.response.contentAsString)
        val room = HrTestRoom(roomNode.path("id").asText(), roomNode.path("inviteCode").asText())

        for (manager in listOf(firstManager, secondManager)) {
            assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(room.id, manager.id)?.role)
            assertTrue(assignmentRepository.existsByRoomIdAndUserId(room.id, manager.id))
            assertEquals(1, assignmentRepository.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id)
                .count { it.user?.id == manager.id })
            mockMvc.get("/api/rooms/${room.inviteCode}") {
                header("Authorization", "Bearer ${manager.token}")
            }.andExpect {
                status { isOk() }
                jsonPath("$.role") { value("interviewer") }
                jsonPath("$.isOwner") { value(false) }
            }
        }
        assertEquals(2, assignmentRepository.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id).size)

        val reconnectSession = "creation-reconnect-${UUID.randomUUID()}"
        joinAccount(room, firstManager, reconnectSession)
        assertEquals(RoomRole.INTERVIEWER, activeRoleFor(room.inviteCode, reconnectSession),
            "reconnect must resolve the committed interviewer membership")

        val (managerOwner, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "create-mgr-owner")
        val ownerTargetCreated = mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${managerOwner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Комната владельца-менеджера",
                "language" to "nodejs",
                "taskIds" to emptyList<String>(),
                "hiringManagerIds" to listOf(managerOwner.id),
            ))
        }.andExpect { status { isOk() } }.andReturn()
        val ownerTargetRoomId = objectMapper.readTree(ownerTargetCreated.response.contentAsString).path("id").asText()
        assertTrue(assignmentRepository.existsByRoomIdAndUserId(ownerTargetRoomId, managerOwner.id),
            "an owner supplied as a target retains the established tracked-assignment semantics")
        assertNull(participantRepository.findByRoomIdAndUserId(ownerTargetRoomId, managerOwner.id),
            "owner targeting must not manufacture a duplicate room participant")
    }

    @Test
    fun `creation rejects unsafe hiring manager targets atomically and rechecks a capability change`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "reject-owner")
        val (eligible, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "reject-eligible")
        val (ineligible, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "reject-ineligible")
        val reusableTask = mockMvc.post("/api/me/tasks") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{
                "title":"Задача для атомарного отклонения",
                "description":"Не должна оказаться в отклонённой комнате",
                "starterCode":"const solve = () => 42;",
                "language":"nodejs"
            }"""
        }.andExpect { status { isOk() } }.andReturn()
        val reusableTaskId = objectMapper.readTree(reusableTask.response.contentAsString).path("id").asText()
        val baselineRooms = roomRepository.findByOwnerUserId(owner.id).size
        val baselineRoomTasks = roomTaskRepository.count()
        val baselineParticipants = participantRepository.count()
        val baselineAssignments = assignmentRepository.count()
        fun createWithTargets(targets: Any?): org.springframework.test.web.servlet.MvcResult =
            mockMvc.post("/api/rooms") {
                header("Authorization", "Bearer ${owner.token}")
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf(
                    "title" to "Отклоняемая комната",
                    "language" to "nodejs",
                    "taskIds" to listOf(reusableTaskId),
                    "hiringManagerIds" to targets,
                ))
            }.andReturn()
        fun assertNoPartialWrite() {
            assertEquals(baselineRooms, roomRepository.findByOwnerUserId(owner.id).size,
                "a rejected target list must not leave an owner room or its tasks")
            assertEquals(baselineRoomTasks, roomTaskRepository.count(),
                "a rejected target list with a real task must not write a room-task row")
            assertEquals(baselineParticipants, participantRepository.count())
            assertEquals(baselineAssignments, assignmentRepository.count())
        }

        val malformed = createWithTargets(listOf("not-a-uuid"))
        val unknown = createWithTargets(listOf("00000000-0000-0000-0000-000000000000"))
        val unavailable = createWithTargets(listOf(ineligible.id))
        for (result in listOf(malformed, unknown, unavailable)) {
            assertEquals(404, result.response.status)
            assertEquals("Указанный нанимающий не найден или недоступен", objectMapper
                .readTree(result.response.contentAsString).path("error").asText())
            assertNoPartialWrite()
        }
        assertEquals(malformed.response.contentAsString, unknown.response.contentAsString)
        assertEquals(unknown.response.contentAsString, unavailable.response.contentAsString)

        assertEquals(400, createWithTargets("not-an-array").response.status)
        assertNoPartialWrite()
        assertEquals(400, mockMvc.post("/api/public/rooms") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Публичная комната",
                "ownerDisplayName" to "Гость",
                "language" to "nodejs",
                "hiringManagerIds" to listOf(eligible.id),
            ))
        }.andReturn().response.status)
        assertEquals(401, mockMvc.post("/api/rooms") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Без авторизации",
                "language" to "nodejs",
                "hiringManagerIds" to listOf(eligible.id),
            ))
        }.andReturn().response.status)

        // This is the serialized eligibility-change boundary: after an opt-out
        // commits, a later create must re-read the stored capability instead of
        // trusting the copied invitation UUID from the dashboard draft.
        mockMvc.patch("/api/me/profile") {
            header("Authorization", "Bearer ${eligible.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Недоступный менеджер","isHr":false}"""
        }.andExpect { status { isOk() } }
        val afterDisable = createWithTargets(listOf(eligible.id))
        assertEquals(404, afterDisable.response.status)
        assertNoPartialWrite()
    }

    @Test
    fun `positive preview cannot authorize creation after target opts out`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-race-owner")
        val (manager, managerRegistration) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-race-mgr")
        val previewedName = managerRegistration.path("user").path("displayName").asText()
        val task = mockMvc.post("/api/me/tasks") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{
                "title":"Задача после preview",
                "description":"Не должна попасть в отклонённую комнату",
                "starterCode":"const solve = () => 42;",
                "language":"nodejs"
            }"""
        }.andExpect { status { isOk() } }.andReturn()
        val taskId = objectMapper.readTree(task.response.contentAsString).path("id").asText()
        val baselineRooms = roomRepository.count()
        val baselineTasks = roomTaskRepository.count()
        val baselineParticipants = participantRepository.count()
        val baselineAssignments = assignmentRepository.count()

        mockMvc.post("/api/me/hiring-manager-preview") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("invitationId" to manager.id))
        }.andExpect {
            status { isOk() }
            jsonPath("$.normalizedId") { value(manager.id) }
            jsonPath("$.displayName") { value(previewedName) }
        }

        mockMvc.patch("/api/me/profile") {
            header("Authorization", "Bearer ${manager.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Отключён после preview","isHr":false}"""
        }.andExpect { status { isOk() } }
        val create = mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Комната после устаревшего preview",
                "language" to "nodejs",
                "taskIds" to listOf(taskId),
                "hiringManagerIds" to listOf(manager.id),
            ))
        }.andReturn()

        assertEquals(404, create.response.status)
        assertEquals("Указанный нанимающий не найден или недоступен", objectMapper
            .readTree(create.response.contentAsString).path("error").asText())
        assertEquals(baselineRooms, roomRepository.count())
        assertEquals(baselineTasks, roomTaskRepository.count())
        assertEquals(baselineParticipants, participantRepository.count())
        assertEquals(baselineAssignments, assignmentRepository.count())
    }

    @Test
    fun `authenticated creation derives creator identity and role only from the bearer token`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "forged-owner")
        val (hiringManager, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "forged-manager")
        val (forgedCreator, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "forged-creator")

        val created = mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "title" to "Комната с поддельным создателем",
                "language" to "nodejs",
                "taskIds" to emptyList<String>(),
                "hiringManagerIds" to listOf(hiringManager.id),
                // These untrusted fields must neither select the room owner nor
                // confer the capability carried by the forged account.
                "ownerUserId" to forgedCreator.id,
                "id" to forgedCreator.id,
                "role" to "admin",
                "isHr" to true,
            ))
        }.andExpect {
            status { isOk() }
            jsonPath("$.accessMembers[0].userId") { value(owner.id) }
            jsonPath("$.accessMembers[0].role") { value("owner") }
        }.andReturn()
        val roomNode = objectMapper.readTree(created.response.contentAsString)
        val roomId = roomNode.path("id").asText()
        val inviteCode = roomNode.path("inviteCode").asText()

        mockMvc.get("/api/rooms/${inviteCode}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.isOwner") { value(true) }
            jsonPath("$.role") { value("owner") }
        }
        assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(roomId, hiringManager.id)?.role)
        assertTrue(assignmentRepository.existsByRoomIdAndUserId(roomId, hiringManager.id))
    }

    @Test
    fun `concurrent opt-out and creation leave either a durable assignment or no room`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "race-owner")
        val (manager, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "race-manager")
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val create = executor.submit<org.springframework.test.web.servlet.MvcResult> {
                ready.countDown()
                check(start.await(5, TimeUnit.SECONDS))
                mockMvc.post("/api/rooms") {
                    header("Authorization", "Bearer ${owner.token}")
                    contentType = MediaType.APPLICATION_JSON
                    content = objectMapper.writeValueAsString(mapOf(
                        "title" to "Комната гонки opt-out",
                        "language" to "nodejs",
                        "taskIds" to emptyList<String>(),
                        "hiringManagerIds" to listOf(manager.id),
                    ))
                }.andReturn()
            }
            val disable = executor.submit<org.springframework.test.web.servlet.MvcResult> {
                ready.countDown()
                check(start.await(5, TimeUnit.SECONDS))
                mockMvc.patch("/api/me/profile") {
                    header("Authorization", "Bearer ${manager.token}")
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"displayName":"Отключённый в гонке","isHr":false}"""
                }.andReturn()
            }
            check(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val createResult = create.get(10, TimeUnit.SECONDS)
            val disableResult = disable.get(10, TimeUnit.SECONDS)

            assertEquals(200, disableResult.response.status)
            assertEquals(false, userRepository.findById(manager.id).orElseThrow().isHr)
            when (createResult.response.status) {
                200 -> {
                    val roomId = objectMapper.readTree(createResult.response.contentAsString).path("id").asText()
                    assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(roomId, manager.id)?.role)
                    assertTrue(assignmentRepository.existsByRoomIdAndUserId(roomId, manager.id))
                }
                404 -> {
                    assertTrue(roomRepository.findByOwnerUserId(owner.id).isEmpty(),
                        "A rejected concurrent create must roll back its room and all dependent rows")
                    assertTrue(assignmentRepository.findAllByUserId(manager.id).isEmpty())
                }
                else -> throw AssertionError("Concurrent creation must resolve as a committed assignment or generic unavailable target, got ${createResult.response.status}")
            }
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `creation strictly distinguishes omitted empty and malformed hiring-manager fields`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "strict-owner")
        val (manager, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "strict-manager")
        val assignmentBaseline = assignmentRepository.count()

        fun create(body: Map<String, Any?>) = mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(body)
        }.andReturn()
        fun authenticatedBody(targets: Any?) = mapOf<String, Any?>(
            "title" to "Строгая проверка",
            "language" to "nodejs",
            "taskIds" to emptyList<String>(),
            "hiringManagerIds" to targets,
        )

        assertEquals(200, create(mapOf(
            "title" to "Без менеджеров",
            "language" to "nodejs",
            "taskIds" to emptyList<String>(),
        )).response.status)
        assertEquals(200, create(authenticatedBody(emptyList<String>())).response.status)
        assertEquals(assignmentBaseline, assignmentRepository.count())

        val roomCount = roomRepository.count()
        val participantCount = participantRepository.count()
        val assignmentCount = assignmentRepository.count()
        for (targets in listOf(null, "not-an-array", listOf(manager.id, 7))) {
            val result = create(authenticatedBody(targets))
            assertEquals(400, result.response.status)
            assertTrue(objectMapper.readTree(result.response.contentAsString).path("error").isTextual)
            assertEquals(roomCount, roomRepository.count())
            assertEquals(participantCount, participantRepository.count())
            assertEquals(assignmentCount, assignmentRepository.count())
        }

        for (targets in listOf(null, emptyList<String>(), listOf(manager.id))) {
            val result = mockMvc.post("/api/public/rooms") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf(
                    "title" to "Публичная комната",
                    "ownerDisplayName" to "Гость",
                    "language" to "nodejs",
                    "hiringManagerIds" to targets,
                ))
            }.andReturn()
            assertEquals(400, result.response.status)
            assertTrue(objectMapper.readTree(result.response.contentAsString).path("error").isTextual)
            assertEquals(roomCount, roomRepository.count())
            assertEquals(participantCount, participantRepository.count())
            assertEquals(assignmentCount, assignmentRepository.count())
        }
    }

    @Test
    fun `disabled assigned hiring manager can be removed into a reconnect-safe candidate tombstone`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "rm-off-owner")
        val (manager, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "rm-off-manager")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, manager).response.status == 200)

        mockMvc.patch("/api/me/profile") {
            header("Authorization", "Bearer ${manager.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Отключённый менеджер","isHr":false}"""
        }.andExpect { status { isOk() } }

        mockMvc.delete("/api/rooms/${room.inviteCode}/hr-managers/${manager.id}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isNoContent() } }

        assertTrue(assignmentRepository.existsByRoomIdAndUserId(room.id, manager.id))
        assertEquals("candidate", participantRepository.findByRoomIdAndUserId(room.id, manager.id)?.role)
        val session = "disabled-manager-${UUID.randomUUID()}"
        joinAccount(room, manager, session)
        assertEquals(RoomRole.CANDIDATE, activeRoleFor(room.inviteCode, session))
    }

    @Test
    fun `rejected nested permission publication closes only the affected account connections`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "queue-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "queue-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        val ownerSession = "owner-${UUID.randomUUID()}"
        val hrSession = "hr-${UUID.randomUUID()}"
        joinAccount(room, owner, ownerSession)
        joinAccount(room, hr, hrSession)
        val ownerToken = eventTokenFor(room.inviteCode, ownerSession)
        val oldHrToken = eventTokenFor(room.inviteCode, hrSession)
        val service = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        val field = CollaborationService::class.java.getDeclaredField("permissionSyncExecutor").apply { isAccessible = true }
        val originalExecutor = field.get(service)
        val rejectedExecutor = org.mockito.Mockito.mock(java.util.concurrent.ThreadPoolExecutor::class.java)
        org.mockito.Mockito.doThrow(java.util.concurrent.RejectedExecutionException("queue full"))
            .`when`(rejectedExecutor).execute(org.mockito.Mockito.any(Runnable::class.java))
        try {
            field.set(service, rejectedExecutor)
            TransactionTemplate(transactionManager).executeWithoutResult {
                mockMvc.post("/api/rooms/${room.inviteCode}/participants/${hr.id}/role") {
                    header("Authorization", "Bearer ${owner.token}")
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"role":"candidate"}"""
                }.andExpect { status { isOk() } }
                assertEquals(RoomRole.INTERVIEWER, activeRoleFor(room.inviteCode, hrSession))
            }
            assertNull(collaborationService.resolveRoleByEventToken(room.inviteCode, oldHrToken),
                "a rejected publication must invalidate the affected connection's credential")
            assertEquals(RoomRole.OWNER, collaborationService.resolveRoleByEventToken(room.inviteCode, ownerToken))
            mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("sessionId" to hrSession, "type" to "request_state_sync"))
            }.andExpect { status { isForbidden() } }
            mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("sessionId" to ownerSession, "type" to "request_state_sync"))
            }.andExpect { status { isNoContent() } }
        } finally {
            field.set(service, originalExecutor)
        }
    }

    @Test
    fun `delayed invitation callback cannot restore a role revoked by a later commit`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "order-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "order-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        val session = "hr-${UUID.randomUUID()}"
        joinAccount(room, hr, session)
        val executor = Executors.newSingleThreadExecutor()
        try {
            TransactionTemplate(transactionManager).executeWithoutResult {
                TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                    override fun afterCommit() {
                        executor.submit {
                            mockMvc.post("/api/rooms/${room.inviteCode}/participants/${hr.id}/role") {
                                header("Authorization", "Bearer ${owner.token}")
                                contentType = MediaType.APPLICATION_JSON
                                content = """{"role":"candidate"}"""
                            }.andExpect { status { isOk() } }
                        }.get(10, TimeUnit.SECONDS)
                        assertEquals(RoomRole.CANDIDATE, activeRoleFor(room.inviteCode, session))
                    }
                })
                // Loads the interviewer membership into this transaction's
                // persistence context and queues its callback after the competitor.
                require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
            }
            awaitNestedPermissionUpdates()
            assertEquals(RoomRole.CANDIDATE, activeRoleFor(room.inviteCode, session),
                "the older invitation callback must re-read the later committed demotion")
            mockMvc.get("/api/me/hr/rooms/${room.id}") {
                header("Authorization", "Bearer ${hr.token}")
            }.andExpect { status { isNotFound() } }
        } finally {
            executor.shutdownNow()
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["rest", "realtime"])
    fun `active permission changes publish only after successful commit`(channel: String) {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "commit-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "commit-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        val ownerSession = "owner-${UUID.randomUUID()}"
        val hrSession = "hr-${UUID.randomUUID()}"
        joinAccount(room, owner, ownerSession)
        joinAccount(room, hr, hrSession)

        fun revoke() {
            if (channel == "rest") {
                mockMvc.post("/api/rooms/${room.inviteCode}/participants/${hr.id}/role") {
                    header("Authorization", "Bearer ${owner.token}")
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"role":"candidate"}"""
                }.andExpect { status { isOk() } }
            } else {
                collaborationService.handleRealtimeEvent(room.inviteCode, RealtimeEventRequest(
                    sessionId = ownerSession,
                    eventToken = eventTokenFor(room.inviteCode, ownerSession),
                    type = "revoke_interviewer_access",
                    targetUserId = hr.id,
                ))
            }
        }

        val beforeRollback = TransactionTemplate(transactionManager).execute { transaction ->
            revoke()
            transaction.setRollbackOnly()
            activeRoleFor(room.inviteCode, hrSession)
        }
        assertEquals(RoomRole.INTERVIEWER, beforeRollback, "uncommitted role must not reach an active session")
        awaitNestedPermissionUpdates()
        assertEquals(RoomRole.INTERVIEWER, activeRoleFor(room.inviteCode, hrSession), "rollback must preserve active authority")
        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isOk() } }

        val beforeCommit = TransactionTemplate(transactionManager).execute {
            revoke()
            activeRoleFor(room.inviteCode, hrSession)
        }
        assertEquals(RoomRole.INTERVIEWER, beforeCommit)
        awaitNestedPermissionUpdates()
        assertEquals(RoomRole.CANDIDATE, activeRoleFor(room.inviteCode, hrSession), "nested committed role must be published")
        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isNotFound() } }

        // Ordinary HTTP calls own their transaction and publish synchronously
        // after cleanup; no background-worker wait is permitted for this assertion.
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        assertEquals(RoomRole.INTERVIEWER, activeRoleFor(room.inviteCode, hrSession))
        revoke()
        assertEquals(RoomRole.CANDIDATE, activeRoleFor(room.inviteCode, hrSession))
    }

    private fun awaitNestedPermissionUpdates() {
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        val field = CollaborationService::class.java.getDeclaredField("permissionSyncExecutor").apply { isAccessible = true }
        val executor = field.get(target) as java.util.concurrent.ExecutorService
        executor.submit {}.get(10, TimeUnit.SECONDS)
    }

    @ParameterizedTest
    @ValueSource(strings = ["reconnect", "event-token", "realtime"])
    fun `committed HR demotion overrides a stale active session before permission callback`(operation: String) {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "stale-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "stale-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        val hrSession = "hr-${UUID.randomUUID()}"
        joinAccount(room, hr, hrSession)
        val oldEventToken = eventTokenFor(room.inviteCode, hrSession)

        // Model the commit/callback interleaving deterministically: durable role
        // has committed while the previous active connection still holds its grant.
        TransactionTemplate(transactionManager).executeWithoutResult {
            val membership = participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!
            membership.role = "candidate"
            participantRepository.save(membership)
        }
        assertEquals(RoomRole.INTERVIEWER, activeRoleFor(room.inviteCode, hrSession))

        when (operation) {
            "reconnect" -> {
                val reconnectedSession = "reconnect-${UUID.randomUUID()}"
                joinAccount(room, hr, reconnectedSession)
                assertEquals(RoomRole.CANDIDATE, activeRoleFor(room.inviteCode, reconnectedSession))
            }
            "event-token" -> mockMvc.get("/api/rooms/${room.inviteCode}/interview-metadata") {
                header("X-Room-Event-Token", oldEventToken)
            }.andExpect { status { isForbidden() } }
            "realtime" -> mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf(
                    "sessionId" to hrSession, "eventToken" to oldEventToken,
                    "type" to "notes_update", "notes" to "must not be written",
                ))
            }.andExpect { status { isForbidden() } }
        }
    }

    private fun joinAccount(room: HrTestRoom, account: HrTestAccount, session: String) {
        collaborationService.joinRoomSse(room.inviteCode, session, "participant-${account.id}",
            "Participant", null, null, userRepository.findById(account.id).orElseThrow())
    }

    private fun activeRoleFor(inviteCode: String, sessionId: String): RoomRole =
        privateField(activeParticipant(inviteCode, sessionId), "role") as RoomRole

    @Test
    fun `manager invitation is idempotent and grants durable interviewer authority to an HR account`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "manager")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)

        repeat(2) {
            mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hr.id}") {
                header("Authorization", "Bearer ${owner.token}")
            }.andExpect {
                status { isOk() }
                jsonPath("$.length()") { value(1) }
                jsonPath("$[0].userId") { value(hr.id) }
            }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("interviewer") }
            jsonPath("$.canManageRoom") { value(true) }
            jsonPath("$.isOwner") { value(false) }
            jsonPath("$.ownerToken") { doesNotExist() }
        }
    }

    @Test
    fun `concurrent invitations deduplicate the durable manager assignment`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "concurrent-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "concurrent-manager")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        val ready = CountDownLatch(6)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(6)
        try {
            val responses = (1..6).map {
                executor.submit<Int> {
                    ready.countDown()
                    start.await(5, TimeUnit.SECONDS)
                    HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status
                }
            }
            check(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            assertEquals(listOf(200), responses.map { it.get(10, TimeUnit.SECONDS) }.distinct())
        } finally {
            executor.shutdownNow()
        }

        mockMvc.get("/api/rooms/${room.inviteCode}/hr-managers") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.length()") { value(1) }
            jsonPath("$[0].userId") { value(hr.id) }
        }
    }

    @Test
    fun `demotion removes cabinet authority but keeps candidate tombstone and reinvitation restores it once`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "reinvite-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "reinvite-manager")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)

        mockMvc.post("/api/rooms/${room.inviteCode}/participants/${hr.id}/role") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"role":"candidate"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$[?(@.userId == '${hr.id}')].role") { value("candidate") }
        }

        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isNotFound() } }
        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("candidate") }
            jsonPath("$.canManageRoom") { value(false) }
        }

        repeat(2) { require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200) }
        mockMvc.get("/api/rooms/${room.inviteCode}/hr-managers") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.length()") { value(1) }
            jsonPath("$[0].userId") { value(hr.id) }
        }
    }

    @Test
    fun `invitation hides missing and non-HR targets and rejects candidate callers`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "target-owner")
        val (ordinary, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "target-ordinary")
        val (candidateHr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "target-candidate")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)

        val missingStatus = mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/00000000-0000-0000-0000-000000000000") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn().response
        val ordinaryStatus = mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${ordinary.id}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn().response
        assertEquals(404, missingStatus.status)
        assertEquals(missingStatus.contentAsString, ordinaryStatus.contentAsString)

        mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${candidateHr.id}") {
            header("Authorization", "Bearer ${candidateHr.token}")
        }.andExpect {
            status { isForbidden() }
        }
    }

    @Test
    fun `authenticated manager tracking is idempotent and candidate tracking is forbidden`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "tracking-owner")
        val (candidate, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "tracking-candidate")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)

        repeat(2) {
            mockMvc.post("/api/rooms/${room.inviteCode}/hr-tracking") {
                header("Authorization", "Bearer ${owner.token}")
                contentType = MediaType.APPLICATION_JSON
            }.andExpect {
                status { isOk() }
                jsonPath("$.roomId") { value(room.id) }
                jsonPath("$.tracked") { value(true) }
            }
        }

        mockMvc.post("/api/rooms/${room.inviteCode}/hr-tracking") {
            header("Authorization", "Bearer ${candidate.token}")
        }.andExpect {
            status { isForbidden() }
        }
    }

    @Test
    fun `promoted guest manager can invite an HR account with its event token`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "guest-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "guest-target")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        val ownerSession = "owner-${UUID.randomUUID()}"
        val guestSession = "guest-${UUID.randomUUID()}"
        collaborationService.joinRoomSse(
            room.inviteCode,
            ownerSession,
            "owner-participant",
            "Owner",
            null,
            null,
            userRepository.findById(owner.id).orElseThrow(),
        )
        collaborationService.joinRoomSse(
            room.inviteCode,
            guestSession,
            "guest-participant",
            "Guest manager",
            null,
            null,
            null,
        )
        collaborationService.handleRealtimeEvent(
            room.inviteCode,
            RealtimeEventRequest(
                sessionId = ownerSession,
                eventToken = eventTokenFor(room.inviteCode, ownerSession),
                type = "grant_interviewer_access",
                targetSessionId = guestSession,
            ),
        )

        mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hr.id}") {
            header("X-Room-Event-Token", eventTokenFor(room.inviteCode, guestSession))
        }.andExpect {
            status { isOk() }
            jsonPath("$[0].userId") { value(hr.id) }
        }
    }

    @Test
    fun `realtime revocation also persists the durable HR candidate tombstone`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "rt-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "rt-manager")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        val ownerSession = "owner-${UUID.randomUUID()}"
        collaborationService.joinRoomSse(
            room.inviteCode,
            ownerSession,
            "owner-participant",
            "Owner",
            null,
            null,
            userRepository.findById(owner.id).orElseThrow(),
        )
        collaborationService.handleRealtimeEvent(
            room.inviteCode,
            RealtimeEventRequest(
                sessionId = ownerSession,
                eventToken = eventTokenFor(room.inviteCode, ownerSession),
                type = "revoke_interviewer_access",
                targetUserId = hr.id,
            ),
        )

        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isNotFound() } }
        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("candidate") }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun eventTokenFor(inviteCode: String, sessionId: String): String {
        return privateField(activeParticipant(inviteCode, sessionId), "eventToken") as String
    }

    @Suppress("UNCHECKED_CAST")
    private fun activeParticipant(inviteCode: String, sessionId: String): Any {
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        val field = CollaborationService::class.java.getDeclaredField("participants").apply { isAccessible = true }
        val participants = field.get(target) as Map<String, Any>
        return participants.values.single { candidate ->
            privateField(candidate, "inviteCode") == inviteCode && privateField(candidate, "sessionId") == sessionId
        }
    }

    private fun privateField(instance: Any, name: String): Any? = instance.javaClass.getDeclaredField(name)
        .apply { isAccessible = true }
        .get(instance)
}
