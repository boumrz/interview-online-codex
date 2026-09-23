package com.interviewonline.repository

import com.interviewonline.model.CommandReceipt
import com.interviewonline.model.CommandReceiptId
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface CommandReceiptRepository : JpaRepository<CommandReceipt, CommandReceiptId> {
    @Query("select (count(receipt) > 0) from CommandReceipt receipt where receipt.id.actorUserId = :userId")
    fun existsForActor(@Param("userId") userId: String): Boolean
}
