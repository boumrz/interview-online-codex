package com.interviewonline.service

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class HostNotesStorageCompatibilityTest {
    @Test
    fun `normalization and task migration preserve explicit host proof and default legacy entries to false`() {
        val mapper = jacksonObjectMapper().configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        val json = """{"version":1,"authors":{"p:host":{"entries":[{"id":"host","text":"Host note","timestampEpochMs":1,"writtenByHost":true},{"id":"legacy","text":"Legacy note","timestampEpochMs":2}]}}}"""
        val parsed = mapper.readValue(json, RoomPrivateNotesPayload::class.java)
        val authors = PrivateNotesSerialization.readAuthorsPayload(parsed.authors, 2000, 64, 8000)
        val stored = mapper.readTree(PrivateNotesSerialization.serializeRoomPrivateNotes(authors, mapper, 2000, 64, 8000)).path("authors").path("p:host").path("entries")
        assertTrue(stored[0].path("writtenByHost").asBoolean())
        assertFalse(stored[1].path("writtenByHost").asBoolean())

        val room = Room().apply { tasks.add(RoomTask(room = this, stepIndex = 2, privateNotesJson = json)) }
        val migrated = PrivateNotesSerialization.migrateLegacyTaskPrivateNotes(room, mapper, 2000, 64, 8000)
        val restored = mapper.readTree(PrivateNotesSerialization.serializeRoomPrivateNotes(migrated, mapper, 2000, 64, 8000)).path("authors").path("p:host").path("entries")
        assertTrue(restored[0].path("writtenByHost").asBoolean())
        assertFalse(restored[1].path("writtenByHost").asBoolean())
        assertEquals(2, restored[0].path("blockStepIndex").asInt())
    }
}
