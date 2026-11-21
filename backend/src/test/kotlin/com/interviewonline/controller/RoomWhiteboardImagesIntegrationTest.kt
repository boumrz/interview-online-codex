package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import java.util.Base64
import java.security.MessageDigest

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomWhiteboardImagesIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_whiteboard_images")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
        private const val PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    }

    @Test fun `images commit with assets before notification survive reload and undo and reuse immutable files`() {
        postgres.verifyPostgres16()
        val room = room(); val candidate = connect(room); val observer = connect(room, true)
        val empty = body(get(room, candidate))
        assertEquals(mapper.createObjectNode(), empty.path("files"))
        val board = empty.path("boardId").asText()
        val operation = UUID.randomUUID().toString()
        val original = image("worksheet", "asset")
        val files = mapOf("asset" to file("asset"))
        val saved = save(room, candidate, board, listOf(original), files, operation)
        assertEquals(200, saved.response.status, saved.response.contentAsString)
        assertEquals(200, save(room, candidate, board, listOf(original), files, operation).response.status)
        assertEquals(1, body(get(room, observer)).path("sequence").asInt())
        assertEquals(mapper.valueToTree<JsonNode>(files), body(get(room, observer)).path("files"))
        assertEquals(mapper.valueToTree<JsonNode>(files), mapper.readTree(jdbc.queryForObject("SELECT files FROM room_whiteboards WHERE id=?", String::class.java, board)))
        val changed = messages(observer.result).last { it.path("type").asText() == "whiteboard_changed" }
        assertFalse(changed.toString().contains("data:image"))
        assertEquals(1, changed.path("payload").path("sequence").asInt())
        assertEquals(200, save(room, candidate, board, listOf(original + mapOf("version" to 2, "isDeleted" to true))).response.status)
        assertEquals(PNG, body(get(room, observer)).path("files").path("asset").path("dataURL").asText())
        assertEquals(200, save(room, candidate, board, listOf(original + mapOf("version" to 3, "x" to 45, "width" to 150))).response.status)
        assertEquals(45, body(get(room, observer)).path("elements").single().path("x").asInt())
        assertEquals(200, save(room, candidate, board, listOf(image("copy", "asset")), mapOf("asset" to (file("asset") + mapOf("created" to 999, "lastRetrieved" to 999)))).response.status)
        assertEquals(1, body(get(room, observer)).path("files").size())
    }

    @Test fun `missing assets changed bytes and unreferenced uploads reject the entire operation`() {
        val room = room(); val candidate = connect(room); val board = body(get(room, candidate)).path("boardId").asText()
        assertEquals(400, save(room, candidate, board, listOf(image("missing", "asset"))).response.status)
        assertEquals(200, save(room, candidate, board, listOf(image("safe", "asset")), mapOf("asset" to file("asset"))).response.status)
        val replacement = file("asset") + mapOf("dataURL" to ("data:image/png;base64," + Base64.getEncoder().encodeToString(Base64.getDecoder().decode(PNG.substringAfter(',')).let { it.copyOf(it.size + 1) })))
        assertEquals(400, save(room, candidate, board, listOf(image("safe", "asset") + mapOf("version" to 2, "x" to 900)), mapOf("asset" to replacement)).response.status)
        assertEquals(400, save(room, candidate, board, listOf(image("dead", "absent") + mapOf("isDeleted" to true))).response.status)
        assertEquals(400, save(room, candidate, board, listOf(image("another", "asset")), mapOf("unreferenced" to file("unreferenced"))).response.status)
        val saved = body(get(room, candidate))
        assertEquals(1, saved.path("sequence").asInt())
        assertEquals(0, saved.path("elements").single().path("x").asInt())
        assertEquals(PNG, saved.path("files").path("asset").path("dataURL").asText())
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `image assets obey task privacy lifecycle authority and deletion`() {
        val room = room(); val first = task(room, 0); val draft = task(room, 1)
        val candidate = connect(room); val manager = connect(room, true)
        val firstBoard = body(get(room, manager, first)).path("boardId").asText()
        val draftBoard = body(get(room, manager, draft)).path("boardId").asText()
        assertEquals(200, save(room, manager, draftBoard, listOf(image("private", "draft-asset")), mapOf("draft-asset" to file("draft-asset")), taskId = draft).response.status)
        assertEquals(404, get(room, candidate, draft).response.status)
        assertEquals(404, get(room, candidate, draft, knownFileIds = "draft-asset").response.status)
        assertEquals(400, save(room, candidate, firstBoard, listOf(image("steal", "draft-asset")), taskId = first).response.status)
        assertTrue(body(get(room, candidate, first)).path("files").isEmpty)
        assertEquals(200, save(room, candidate, firstBoard, listOf(image("public", "asset")), mapOf("asset" to file("asset")), taskId = first).response.status)
        jdbc.update("UPDATE rooms SET status='finished',finished_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        assertEquals(403, save(room, candidate, firstBoard, listOf(image("denied", "new")), mapOf("new" to file("new")), taskId = first).response.status)
        assertEquals(1, body(get(room, candidate, first)).path("files").size())
        assertEquals(200, save(room, manager, firstBoard, listOf(image("allowed", "asset")), taskId = first).response.status)
        jdbc.update("UPDATE rooms SET status='frozen' WHERE id=?", room.id)
        assertEquals(409, save(room, manager, firstBoard, listOf(image("frozen", "new")), mapOf("new" to file("new")), taskId = first).response.status)
        jdbc.update("DELETE FROM room_tasks WHERE id=?", draft)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboards WHERE id=?", Int::class.java, draftBoard))
        rooms.deleteById(room.id!!)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboards WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `known assets are omitted from incremental reads new assets are included and unchanged bytes are not rewritten`() {
        val room = room(); val candidate = connect(room); val observer = connect(room, true)
        val board = body(get(room, candidate)).path("boardId").asText()
        assertEquals(200, save(room, candidate, board, listOf(image("first", "asset-a")), mapOf("asset-a" to file("asset-a"))).response.status)
        val incremental = get(room, observer, knownFileIds = "asset-a")
        assertEquals(200, incremental.response.status)
        assertTrue(body(incremental).path("files").isEmpty, "already loaded image bytes must not travel after each stroke")
        assertEquals(1, body(incremental).path("elements").size())
        assertEquals(200, save(room, candidate, board, listOf(image("second", "asset-b")), mapOf("asset-b" to file("asset-b"))).response.status)
        assertEquals(setOf("asset-b"), body(get(room, observer, knownFileIds = "asset-a")).path("files").fieldNames().asSequence().toSet())
        assertTrue(body(get(room, observer, knownFileIds = "asset-a,asset-b")).path("files").isEmpty)
        assertEquals(setOf("asset-a", "asset-b"), body(get(room, observer)).path("files").fieldNames().asSequence().toSet(), "reload without cached IDs retrieves every asset")
        assertEquals(403, get(room, observer.copy(token = "invalid"), knownFileIds = "asset-a,asset-b").response.status)
        assertEquals(400, get(room, observer, knownFileIds = "asset-a,__proto__").response.status)
        assertEquals(400, get(room, observer, knownFileIds = (1..101).joinToString(",") { "file-$it" }).response.status)
        jdbc.execute("CREATE FUNCTION reject_unchanged_asset_write() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Image bytes rewritten during an element update''; END;'")
        jdbc.execute("CREATE TRIGGER image_bytes_write_guard BEFORE UPDATE OF files ON room_whiteboards FOR EACH ROW WHEN (OLD.id = '$board') EXECUTE FUNCTION reject_unchanged_asset_write()")
        try {
            val moved = save(room, candidate, board, listOf(image("first", "asset-a") + mapOf("version" to 2, "x" to 50)))
            assertEquals(200, moved.response.status, moved.response.contentAsString)
        } finally {
            jdbc.execute("DROP TRIGGER image_bytes_write_guard ON room_whiteboards")
            jdbc.execute("DROP FUNCTION reject_unchanged_asset_write()")
        }
        assertTrue(body(get(room, observer, knownFileIds = "asset-a,asset-b")).path("files").isEmpty)
        assertEquals(3, body(get(room, observer)).path("sequence").asInt())
    }

    @Test fun `legacy element only receipts retain retry identity after image support`() {
        val room = room(); val candidate = connect(room); val board = body(get(room, candidate)).path("boardId").asText()
        val element = image("legacy", "asset").filterKeys { it !in setOf("fileId", "status", "scale", "crop") } + mapOf("type" to "rectangle")
        val operation = UUID.randomUUID().toString()
        assertEquals(200, save(room, candidate, board, listOf(element), operation = operation).response.status)
        fun canonical(node: JsonNode): JsonNode = when {
            node.isObject -> mapper.createObjectNode().also { result -> node.fieldNames().asSequence().sorted().forEach { result.set<JsonNode>(it, canonical(node.path(it))) } }
            node.isArray -> mapper.createArrayNode().also { result -> node.forEach { result.add(canonical(it)) } }
            else -> node
        }
        val legacy = mapper.valueToTree<JsonNode>(mapOf("boardId" to board, "operationId" to operation, "baseSequence" to 0, "elements" to listOf(element)))
        val intent = mapper.writeValueAsString(canonical(legacy))
        val fingerprint = MessageDigest.getInstance("SHA-256").digest("${candidate.session}\n$intent".toByteArray()).joinToString("") { "%02x".format(it) }
        jdbc.update("UPDATE room_whiteboard_operations SET fingerprint=? WHERE board_id=? AND operation_id=?", fingerprint, board, operation)
        assertEquals(200, save(room, candidate, board, listOf(element), operation = operation).response.status)
        assertEquals(200, save(room, candidate, board, listOf(element), emptyMap(), operation).response.status)
        assertEquals(1, body(get(room, candidate)).path("sequence").asInt())
        assertEquals(mapper.createObjectNode(), body(get(room, candidate)).path("files"))
    }

    @Test fun `retained tombstone files count towards the hundred file board limit`() {
        val room = room(); val candidate = connect(room); val board = body(get(room, candidate)).path("boardId").asText()
        val elements = (1..100).map { image("image-$it", "file-$it") + mapOf("isDeleted" to true) }
        val files = (1..100).associate { "file-$it" to file("file-$it") }
        assertEquals(200, save(room, candidate, board, elements, files).response.status)
        assertEquals(400, save(room, candidate, board, listOf(image("overflow", "new")), mapOf("new" to file("new"))).response.status)
        assertEquals(100, body(get(room, candidate)).path("files").size())
        assertEquals(1, body(get(room, candidate)).path("sequence").asInt())
    }

    private fun room() = rooms.saveAndFlush(Room(title = "Board images", inviteCode = "img-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}"))
    private data class Connection(val session: String, val token: String, val result: MvcResult)
    private fun connect(room: Room, owner: Boolean = false): Connection {
        val session = "image-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", session); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, result.response.status)
        val state = messages(result).last { it.path("type").asText() == "state_sync" }.path("payload")
        return Connection(session, state.path("eventToken").asText(), result)
    }
    private fun get(room: Room, actor: Connection, taskId: String? = null, knownFileIds: String? = null) = mvc.get("/api/rooms/${room.inviteCode}/whiteboard") {
        param("sessionId", actor.session); header("X-Room-Event-Token", actor.token)
        taskId?.let { param("taskId", it) }
        knownFileIds?.let { param("knownFileIds", it) }
    }.andReturn()
    private fun save(room: Room, actor: Connection, board: String, elements: List<Map<String, Any?>>, files: Map<String, Map<String, Any?>>? = null, operation: String = UUID.randomUUID().toString(), taskId: String? = null) = mvc.post("/api/rooms/${room.inviteCode}/whiteboard/changes") {
        param("sessionId", actor.session); header("X-Room-Event-Token", actor.token)
        taskId?.let { param("taskId", it) }
        contentType = MediaType.APPLICATION_JSON
        val request = mutableMapOf<String, Any?>("boardId" to board, "operationId" to operation, "baseSequence" to 0, "elements" to elements)
        if (files != null) request["files"] = files
        content = mapper.writeValueAsString(request)
    }.andReturn()
    private fun task(room: Room, step: Int): String {
        val id = UUID.randomUUID().toString()
        jdbc.update("INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,language) VALUES (?,?,?,'Task','','','nodejs')", id, room.id, step)
        return id
    }
    private fun image(id: String, file: String): Map<String, Any?> = mapOf("id" to id, "type" to "image", "version" to 1, "versionNonce" to 1, "x" to 0, "y" to 0, "width" to 100, "height" to 100, "angle" to 0, "isDeleted" to false, "fileId" to file, "status" to "saved", "scale" to listOf(1, 1), "crop" to null)
    private fun file(id: String): Map<String, Any?> = mapOf("id" to id, "mimeType" to "image/png", "dataURL" to PNG, "created" to 1)
    private fun body(result: MvcResult): JsonNode = mapper.readTree(result.response.contentAsByteArray)
    private fun messages(result: MvcResult) = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }.map { mapper.readTree(it.removePrefix("data:")) }.toList()
}
