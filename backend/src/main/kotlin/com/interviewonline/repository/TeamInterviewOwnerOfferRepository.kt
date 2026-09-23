package com.interviewonline.repository

import com.interviewonline.model.TeamInterviewOwnerOffer
import java.time.Instant
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface TeamInterviewOwnerOfferRepository : JpaRepository<TeamInterviewOwnerOffer, String> {
    fun findByIdAndTeamIdAndRoomId(id: String, teamId: String, roomId: String): TeamInterviewOwnerOffer?

    @Query(value = "SELECT * FROM team_interview_owner_offers WHERE id = :offerId FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("offerId") offerId: String): TeamInterviewOwnerOffer?

    @Query(
        """
        select offer from TeamInterviewOwnerOffer offer
        where offer.teamId = :teamId and offer.roomId = :roomId
          and offer.status = 'PENDING' and offer.expiresAt > :now
        """,
    )
    fun findActivePendingByTeamIdAndRoomId(
        @Param("teamId") teamId: String,
        @Param("roomId") roomId: String,
        @Param("now") now: Instant,
    ): List<TeamInterviewOwnerOffer>

    @Query(
        """
        select offer from TeamInterviewOwnerOffer offer
        where offer.teamId = :teamId and offer.toUserId = :toUserId
          and offer.status = 'PENDING' and offer.expiresAt > :now
        order by offer.createdAt desc, offer.id asc
        """,
    )
    fun findActivePendingByTeamIdAndToUserId(
        @Param("teamId") teamId: String,
        @Param("toUserId") toUserId: String,
        @Param("now") now: Instant,
    ): List<TeamInterviewOwnerOffer>

    @Modifying
    @Query(
        """
        update TeamInterviewOwnerOffer offer
        set offer.status = 'EXPIRED', offer.respondedAt = :now
        where offer.teamId = :teamId and offer.roomId = :roomId
          and offer.status = 'PENDING' and offer.expiresAt <= :now
        """,
    )
    fun expirePendingForRoom(
        @Param("teamId") teamId: String,
        @Param("roomId") roomId: String,
        @Param("now") now: Instant,
    ): Int

    @Modifying
    @Query(
        """
        update TeamInterviewOwnerOffer offer
        set offer.status = 'EXPIRED', offer.respondedAt = :now
        where offer.teamId = :teamId and offer.toUserId = :toUserId
          and offer.status = 'PENDING' and offer.expiresAt <= :now
        """,
    )
    fun expirePendingForTarget(
        @Param("teamId") teamId: String,
        @Param("toUserId") toUserId: String,
        @Param("now") now: Instant,
    ): Int

    @Modifying
    @Query(
        """
        update TeamInterviewOwnerOffer offer
        set offer.status = 'CANCELLED', offer.respondedAt = :now
        where offer.teamId = :teamId and offer.roomId = :roomId
          and offer.status = 'PENDING'
        """,
    )
    fun cancelPendingForRoom(
        @Param("teamId") teamId: String,
        @Param("roomId") roomId: String,
        @Param("now") now: Instant,
    ): Int
}
