package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.Table
import java.io.Serializable
import java.time.Instant

@Embeddable
data class CommandReceiptId(
    @Column(name = "actor_user_id", nullable = false)
    var actorUserId: String = "",

    @Column(name = "scope_kind", nullable = false, length = 32)
    var scopeKind: String = "",

    @Column(name = "scope_id", nullable = false)
    var scopeId: String = "",

    @Column(nullable = false, length = 64)
    var operation: String = "",

    @Column(name = "idempotency_key", nullable = false, length = 36)
    var idempotencyKey: String = "",
) : Serializable

@Entity
@Table(name = "command_receipts")
class CommandReceipt(
    @EmbeddedId
    var id: CommandReceiptId = CommandReceiptId(),

    @Column(name = "request_hash", nullable = false, length = 67)
    var requestHash: String = "",

    @Column(nullable = false, length = 32)
    var outcome: String = "CREATED",

    @Column(nullable = false)
    var status: Int = 201,

    @Column(name = "resource_id", nullable = false)
    var resourceId: String = "",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "expires_at", nullable = false)
    var expiresAt: Instant = Instant.now(),
)
