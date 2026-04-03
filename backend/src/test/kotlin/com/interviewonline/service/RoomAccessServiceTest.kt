package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito

class RoomAccessServiceTest {
    private val roomParticipantRepository = Mockito.mock(RoomParticipantRepository::class.java)
    private val roomAccessService = RoomAccessService(roomParticipantRepository)

    @Test
    fun `room owner is resolved as owner without legacy room tokens`() {
        val owner = User(id = "user-owner", nickname = "owner", passwordHash = "hash")
        val room = Room(
            id = "room-1",
            inviteCode = "r-1",
            ownerSessionToken = "owner-token",
            interviewerSessionToken = "interviewer-token",
            ownerUser = owner,
        )

        val access = roomAccessService.resolveAccess(room, owner)

        assertEquals(RoomAccessService.RoomRole.OWNER, access.role)
        assertTrue(access.isOwner)
        assertTrue(access.canManageRoom)
        assertTrue(access.canGrantAccess)
    }

    @Test
    fun `persisted room participant is resolved as interviewer`() {
        val user = User(id = "user-interviewer", nickname = "interviewer", passwordHash = "hash")
        val room = Room(
            id = "room-2",
            inviteCode = "r-2",
            ownerSessionToken = "owner-token",
            interviewerSessionToken = "interviewer-token",
            ownerUser = User(id = "owner-2", nickname = "owner", passwordHash = "hash"),
        )
        Mockito.`when`(roomParticipantRepository.findByRoomIdAndUserId("room-2", "user-interviewer"))
            .thenReturn(
                RoomParticipant(
                    room = room,
                    user = user,
                    role = "interviewer",
                ),
            )

        val access = roomAccessService.resolveAccess(room, user)

        assertEquals(RoomAccessService.RoomRole.INTERVIEWER, access.role)
        assertFalse(access.isOwner)
        assertTrue(access.canManageRoom)
        assertFalse(access.canGrantAccess)
    }

    @Test
    fun `legacy interviewer token still works for ownerless guest room`() {
        val room = Room(
            id = "room-3",
            inviteCode = "r-3",
            ownerSessionToken = "owner-token",
            interviewerSessionToken = "interviewer-token",
            ownerUser = null,
        )

        val access = roomAccessService.resolveAccess(
            room = room,
            user = null,
            ownerToken = null,
            interviewerToken = "interviewer-token",
        )

        assertEquals(RoomAccessService.RoomRole.INTERVIEWER, access.role)
        assertTrue(access.canManageRoom)
        assertFalse(access.canGrantAccess)
    }
}
