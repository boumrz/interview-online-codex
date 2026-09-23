package com.interviewonline.repository

import com.interviewonline.model.RoomHrAssignment
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant

data class HrRoomRow(
    val roomId: String,
    val title: String,
    val inviteCode: String,
    val candidateName: String?,
    val position: String?,
    val scheduledAt: Instant?,
    val createdAt: Instant,
    val finishedAt: Instant?,
    val archivedAt: Instant?,
    val status: String?,
    val verdict: String?,
    val verdictComment: String?,
)

interface HrInterviewQueryRepository : JpaRepository<RoomHrAssignment, String> {
    @Query(
        value = """
        select new com.interviewonline.repository.HrRoomRow(
            room.id, room.title, room.inviteCode, room.candidateName, room.position,
            room.scheduledAt, room.createdAt, room.finishedAt, room.archivedAt,
            room.status, room.verdict, room.verdictComment
        )
        from Room room, User assigned
        where assigned.id = :userId and assigned.isHr = true
          and (room.ownerUser.id = :userId or exists (
              select participant.id from RoomParticipant participant
              where participant.room.id = room.id and participant.user.id = :userId
                and participant.role = 'interviewer'
          ))
          and (
              (room.teamId is null and (room.ownerUser.id = :userId or exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
              )))
              or
              (room.teamId is not null and room.originTeamId = room.teamId and exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE'
              ))
          )
        order by coalesce(room.scheduledAt, room.finishedAt, room.createdAt) desc, room.id asc
        """,
        countQuery = """
        select count(room.id)
        from Room room, User assigned
        where assigned.id = :userId and assigned.isHr = true
          and (room.ownerUser.id = :userId or exists (
              select participant.id from RoomParticipant participant
              where participant.room.id = room.id and participant.user.id = :userId
                and participant.role = 'interviewer'
          ))
          and (
              (room.teamId is null and (room.ownerUser.id = :userId or exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
              )))
              or
              (room.teamId is not null and room.originTeamId = room.teamId and exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE'
              ))
          )
        """,
    )
    fun findAuthorized(@Param("userId") userId: String, pageable: Pageable): Page<HrRoomRow>

    @Query(
        value = """
        select new com.interviewonline.repository.HrRoomRow(
            room.id, room.title, room.inviteCode, room.candidateName, room.position,
            room.scheduledAt, room.createdAt, room.finishedAt, room.archivedAt,
            room.status, room.verdict, room.verdictComment
        )
        from Room room, User assigned
        where assigned.id = :userId and assigned.isHr = true
          and (room.ownerUser.id = :userId or exists (
              select participant.id from RoomParticipant participant
              where participant.room.id = room.id and participant.user.id = :userId
                and participant.role = 'interviewer'
          ))
          and (
              (room.teamId is null and (room.ownerUser.id = :userId or exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
              )))
              or
              (room.teamId is not null and room.originTeamId = room.teamId and exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE'
              ))
          )
          and coalesce(room.scheduledAt, room.finishedAt, room.createdAt) >= :startAt
          and coalesce(room.scheduledAt, room.finishedAt, room.createdAt) < :endExclusive
        order by coalesce(room.scheduledAt, room.finishedAt, room.createdAt) desc, room.id asc
        """,
        countQuery = """
        select count(room.id)
        from Room room, User assigned
        where assigned.id = :userId and assigned.isHr = true
          and (room.ownerUser.id = :userId or exists (
              select participant.id from RoomParticipant participant
              where participant.room.id = room.id and participant.user.id = :userId
                and participant.role = 'interviewer'
          ))
          and (
              (room.teamId is null and (room.ownerUser.id = :userId or exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
              )))
              or
              (room.teamId is not null and room.originTeamId = room.teamId and exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE'
              ))
          )
          and coalesce(room.scheduledAt, room.finishedAt, room.createdAt) >= :startAt
          and coalesce(room.scheduledAt, room.finishedAt, room.createdAt) < :endExclusive
        """,
    )
    fun findAuthorizedInRange(
        @Param("userId") userId: String,
        @Param("startAt") startAt: Instant,
        @Param("endExclusive") endExclusive: Instant,
        pageable: Pageable,
    ): Page<HrRoomRow>

    @Query(
        """
        select room.id
        from Room room, User assigned
        where assigned.id = :userId and assigned.isHr = true and room.id in :roomIds
          and (room.ownerUser.id = :userId or exists (
              select participant.id from RoomParticipant participant
              where participant.room.id = room.id and participant.user.id = :userId
                and participant.role = 'interviewer'
          ))
          and (
              (room.teamId is null and (room.ownerUser.id = :userId or exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
              )))
              or
              (room.teamId is not null and room.originTeamId = room.teamId and exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE'
              ))
          )
        """,
    )
    fun findAuthorizedRoomIds(
        @Param("userId") userId: String,
        @Param("roomIds") roomIds: Collection<String>,
    ): List<String>

    @Query(
        """
        select new com.interviewonline.repository.HrRoomRow(
            room.id, room.title, room.inviteCode, room.candidateName, room.position,
            room.scheduledAt, room.createdAt, room.finishedAt, room.archivedAt,
            room.status, room.verdict, room.verdictComment
        )
        from Room room, User assigned
        where assigned.id = :userId and assigned.isHr = true and room.id = :roomId
          and (room.ownerUser.id = :userId or exists (
              select participant.id from RoomParticipant participant
              where participant.room.id = room.id and participant.user.id = :userId
                and participant.role = 'interviewer'
          ))
          and (
              (room.teamId is null and (room.ownerUser.id = :userId or exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
              )))
              or
              (room.teamId is not null and room.originTeamId = room.teamId and exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE'
              ))
          )
        """,
    )
    fun findAuthorizedDetail(@Param("userId") userId: String, @Param("roomId") roomId: String): HrRoomRow?
}
