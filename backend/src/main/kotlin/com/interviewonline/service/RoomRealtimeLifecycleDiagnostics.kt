package com.interviewonline.service

import com.zaxxer.hikari.HikariDataSource
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import javax.sql.DataSource

data class RoomRealtimeLifecycleRegistryCounts(
    val connections: Int,
    val participants: Int,
    val roomMemberships: Int,
)

data class RoomRealtimeLifecycleHikariCounts(
    val active: Int,
    val idle: Int,
)

enum class RoomRealtimeLifecycleDiagnosticReason(val wireValue: String) {
    NORMAL_CLOSE("normal-close"),
    ROUTE_UNMOUNT("route-unmount"),
    TRANSPORT_ERROR("transport-error"),
    REPLACEMENT("replacement"),
}

/**
 * Test-only, aggregate lifecycle evidence for the process that hosts room E2E.
 * It is disabled unless the immutable-at-startup property is explicitly true.
 */
@Service
class RoomRealtimeLifecycleDiagnostics(
    private val enabled: Boolean,
    private val hikariCounts: () -> RoomRealtimeLifecycleHikariCounts,
    private val appendLine: (String) -> Unit,
) {
    private val operationLock = Any()
    private var sequence = 0L

    @Autowired
    constructor(
        @Value("\${app.realtime.lifecycle-diagnostics-enabled:\${ROOM_REALTIME_LIFECYCLE_DIAGNOSTICS:false}}")
        enabled: Boolean,
        dataSource: DataSource,
    ) : this(
        enabled = enabled,
        hikariCounts = { readHikariCounts(dataSource) },
        appendLine = { line -> logger.info(line) },
    )

    fun record(
        reason: RoomRealtimeLifecycleDiagnosticReason,
        registryCounts: RoomRealtimeLifecycleRegistryCounts,
    ) = record(reason) { registryCounts }

    fun record(
        reason: RoomRealtimeLifecycleDiagnosticReason,
        registryCounts: () -> RoomRealtimeLifecycleRegistryCounts,
    ) {
        if (!enabled) return

        synchronized(operationLock) {
            runCatching {
                val registry = registryCounts()
                val hikari = hikariCounts()
                val line = "ROOM_REALTIME_LIFECYCLE_DIAG " +
                    "sequence=${++sequence} reason=${reason.wireValue} " +
                    "registryConnections=${registry.connections} " +
                    "registryParticipants=${registry.participants} " +
                    "registryRoomMemberships=${registry.roomMemberships} " +
                    "hikariActive=${hikari.active} hikariIdle=${hikari.idle}"
                appendLine(line)
            }
        }
    }

    private companion object {
        private val logger = LoggerFactory.getLogger(RoomRealtimeLifecycleDiagnostics::class.java)

        private fun readHikariCounts(dataSource: DataSource): RoomRealtimeLifecycleHikariCounts {
            val hikariDataSource = runCatching {
                dataSource.unwrap(HikariDataSource::class.java)
            }.getOrNull() ?: dataSource as? HikariDataSource
            val pool = hikariDataSource?.hikariPoolMXBean
            return RoomRealtimeLifecycleHikariCounts(
                active = pool?.activeConnections ?: 0,
                idle = pool?.idleConnections ?: 0,
            )
        }
    }
}
