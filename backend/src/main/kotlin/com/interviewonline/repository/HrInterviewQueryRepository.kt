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
    val trackId: String?,
    val vacancyId: String?,
)

private const val HR_ROOM_PROJECTION = """
    select new com.interviewonline.repository.HrRoomRow(
        room.id, room.title, room.inviteCode, room.candidateName, room.position,
        room.scheduledAt, room.createdAt, room.finishedAt, room.archivedAt,
        room.status, room.verdict, room.verdictComment, room.teamTrackId, room.teamVacancyId
    )
"""

// Every list, detail and final export check applies the same current authority.
private const val HR_ROOM_AUTHORITY = """
    from Room room, User assigned
    where assigned.id = :userId
      and (
          (room.teamId is null and assigned.isHr = true and (
              room.ownerUser.id = :userId or (
                  exists (select assignment.id from RoomHrAssignment assignment
                      where assignment.room.id = room.id and assignment.user.id = :userId)
                  and exists (select participant.id from RoomParticipant participant
                      where participant.room.id = room.id and participant.user.id = :userId
                        and participant.role in ('owner', 'interviewer'))
              )
          ))
          or
          (room.teamId is not null and room.teamInterviewCreated = true and room.originTeamId = room.teamId and exists (
              select team.id from Team team where team.id = room.teamId and team.state = 'ACTIVE'
          ) and (
              exists (select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state = 'ACTIVE')
              or (assigned.isHr = true and not exists (
                  select membership.id from TeamMembership membership
                  where membership.teamId = room.teamId and membership.userId = :userId
                    and membership.state not in ('LEFT', 'REMOVED')
              ) and exists (
                  select assignment.id from RoomHrAssignment assignment
                  where assignment.room.id = room.id and assignment.user.id = :userId
                    and not exists (
                        select membership.id from TeamMembership membership
                        where membership.teamId = room.teamId and membership.userId = :userId
                          and membership.updatedAt >= assignment.createdAt
                    )
              ) and exists (
                  select participant.id from RoomParticipant participant
                  where participant.room.id = room.id and participant.user.id = :userId
                    and participant.role = 'interviewer'
              ))
          ))
      )
"""
private const val HR_ROOM_FILTERS = """
    and (:teamId is null or room.teamId = :teamId)
    and (:trackId is null or room.teamTrackId = :trackId)
    and (:vacancyId is null or room.teamVacancyId = :vacancyId)
"""
private const val HR_ROOM_RANGE = """
    and coalesce(room.scheduledAt, room.finishedAt, room.createdAt) >= :startAt
    and coalesce(room.scheduledAt, room.finishedAt, room.createdAt) < :endExclusive
"""
private const val HR_ROOM_ORDER = " order by coalesce(room.scheduledAt, room.finishedAt, room.createdAt) desc, room.id asc"

interface HrInterviewQueryRepository : JpaRepository<RoomHrAssignment, String> {
    @Query(
        value = HR_ROOM_PROJECTION + HR_ROOM_AUTHORITY + HR_ROOM_FILTERS + HR_ROOM_ORDER,
        countQuery = "select count(room.id) " + HR_ROOM_AUTHORITY + HR_ROOM_FILTERS,
    )
    fun findAuthorized(
        @Param("userId") userId: String,
        pageable: Pageable,
        @Param("teamId") teamId: String?,
        @Param("trackId") trackId: String?,
        @Param("vacancyId") vacancyId: String?,
    ): Page<HrRoomRow>

    @Query(
        value = HR_ROOM_PROJECTION + HR_ROOM_AUTHORITY + HR_ROOM_FILTERS + HR_ROOM_RANGE + HR_ROOM_ORDER,
        countQuery = "select count(room.id) " + HR_ROOM_AUTHORITY + HR_ROOM_FILTERS + HR_ROOM_RANGE,
    )
    fun findAuthorizedInRange(
        @Param("userId") userId: String,
        @Param("startAt") startAt: Instant,
        @Param("endExclusive") endExclusive: Instant,
        pageable: Pageable,
        @Param("teamId") teamId: String?,
        @Param("trackId") trackId: String?,
        @Param("vacancyId") vacancyId: String?,
    ): Page<HrRoomRow>

    @Query("select room.id " + HR_ROOM_AUTHORITY + " and room.id in :roomIds and (:teamId is null or room.teamId = :teamId)")
    fun findAuthorizedRoomIds(
        @Param("userId") userId: String,
        @Param("roomIds") roomIds: Collection<String>,
        @Param("teamId") teamId: String?,
    ): List<String>

    @Query(HR_ROOM_PROJECTION + HR_ROOM_AUTHORITY + " and room.id = :roomId")
    fun findAuthorizedDetail(@Param("userId") userId: String, @Param("roomId") roomId: String): HrRoomRow?
}
