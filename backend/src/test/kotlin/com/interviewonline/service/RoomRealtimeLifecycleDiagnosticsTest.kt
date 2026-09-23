package com.interviewonline.service

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RoomRealtimeLifecycleDiagnosticsTest {
    private val registryCounts = RoomRealtimeLifecycleRegistryCounts(
        connections = 2,
        participants = 3,
        roomMemberships = 4,
    )

    @Test
    fun `default-off diagnostics write no lifecycle record`() {
        val lines = mutableListOf<String>()
        val diagnostics = RoomRealtimeLifecycleDiagnostics(
            enabled = false,
            hikariCounts = { RoomRealtimeLifecycleHikariCounts(active = 5, idle = 6) },
            appendLine = lines::add,
        )

        diagnostics.record(RoomRealtimeLifecycleDiagnosticReason.NORMAL_CLOSE, registryCounts)

        assertTrue(lines.isEmpty())
    }

    @Test
    fun `default-off diagnostics do not evaluate registry or Hikari suppliers`() {
        var registrySupplierCalls = 0
        var hikariSupplierCalls = 0
        var sinkCalls = 0
        val diagnostics = RoomRealtimeLifecycleDiagnostics(
            enabled = false,
            hikariCounts = {
                hikariSupplierCalls += 1
                RoomRealtimeLifecycleHikariCounts(active = 5, idle = 6)
            },
            appendLine = { sinkCalls += 1 },
        )

        diagnostics.record(RoomRealtimeLifecycleDiagnosticReason.NORMAL_CLOSE) {
            registrySupplierCalls += 1
            registryCounts
        }

        assertEquals(0, registrySupplierCalls)
        assertEquals(0, hikariSupplierCalls)
        assertEquals(0, sinkCalls)
    }

    @Test
    fun `enabled diagnostics write one fixed aggregate lifecycle record`() {
        val lines = mutableListOf<String>()
        val diagnostics = RoomRealtimeLifecycleDiagnostics(
            enabled = true,
            hikariCounts = { RoomRealtimeLifecycleHikariCounts(active = 5, idle = 6) },
            appendLine = lines::add,
        )

        diagnostics.record(RoomRealtimeLifecycleDiagnosticReason.NORMAL_CLOSE, registryCounts)

        assertEquals(
            listOf(
                "ROOM_REALTIME_LIFECYCLE_DIAG sequence=1 reason=normal-close " +
                    "registryConnections=2 registryParticipants=3 registryRoomMemberships=4 " +
                    "hikariActive=5 hikariIdle=6",
            ),
            lines,
        )
    }

    @Test
    fun `every permitted reason writes the fixed schema in strict sequence order`() {
        val lines = mutableListOf<String>()
        val diagnostics = RoomRealtimeLifecycleDiagnostics(
            enabled = true,
            hikariCounts = { RoomRealtimeLifecycleHikariCounts(active = 5, idle = 6) },
            appendLine = lines::add,
        )

        RoomRealtimeLifecycleDiagnosticReason.entries.forEach { reason ->
            diagnostics.record(reason) { registryCounts }
        }

        assertEquals(
            listOf(
                diagnosticLine(1, "normal-close"),
                diagnosticLine(2, "route-unmount"),
                diagnosticLine(3, "transport-error"),
                diagnosticLine(4, "replacement"),
            ),
            lines,
        )
    }

    @Test
    fun `concurrent diagnostics cannot append a later sequence before an earlier one`() {
        val lines = CopyOnWriteArrayList<String>()
        val normalCloseAtFirstAppend = CountDownLatch(1)
        val releaseNormalCloseAppend = CountDownLatch(1)
        val routeUnmountAtAppend = CountDownLatch(1)
        val diagnostics = RoomRealtimeLifecycleDiagnostics(
            enabled = true,
            hikariCounts = { RoomRealtimeLifecycleHikariCounts(active = 5, idle = 6) },
            appendLine = { line ->
                if (line.contains("sequence=1 reason=normal-close")) {
                    normalCloseAtFirstAppend.countDown()
                    check(releaseNormalCloseAppend.await(5, TimeUnit.SECONDS))
                }
                if (line.contains("reason=route-unmount")) {
                    routeUnmountAtAppend.countDown()
                }
                lines += line
            },
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val first = executor.submit {
                diagnostics.record(RoomRealtimeLifecycleDiagnosticReason.NORMAL_CLOSE, registryCounts)
            }
            assertTrue(normalCloseAtFirstAppend.await(5, TimeUnit.SECONDS))
            val second = executor.submit {
                diagnostics.record(RoomRealtimeLifecycleDiagnosticReason.ROUTE_UNMOUNT, registryCounts)
            }

            assertFalse(
                routeUnmountAtAppend.await(250, TimeUnit.MILLISECONDS),
                "Without the operation lock, route-unmount would append sequence=2 before normal-close sequence=1",
            )
            releaseNormalCloseAppend.countDown()
            first.get(5, TimeUnit.SECONDS)
            second.get(5, TimeUnit.SECONDS)
        } finally {
            releaseNormalCloseAppend.countDown()
            executor.shutdownNow()
        }

        assertEquals(
            listOf(diagnosticLine(1, "normal-close"), diagnosticLine(2, "route-unmount")),
            lines,
        )
    }

    private fun diagnosticLine(sequence: Int, reason: String): String =
        "ROOM_REALTIME_LIFECYCLE_DIAG sequence=$sequence reason=$reason " +
            "registryConnections=2 registryParticipants=3 registryRoomMemberships=4 " +
            "hikariActive=5 hikariIdle=6"
}

/**
 * The initial scaffold eagerly observes the aggregate before it can decide
 * whether diagnostics are disabled. Once production supplies the matching
 * member overload, Kotlin resolves calls above to that member instead.
 */
private fun RoomRealtimeLifecycleDiagnostics.record(
    reason: RoomRealtimeLifecycleDiagnosticReason,
    registryCounts: () -> RoomRealtimeLifecycleRegistryCounts,
) {
    record(reason, registryCounts())
}
