package com.interviewonline.service

import com.zaxxer.hikari.HikariDataSource
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.sql.DataSource

/**
 * An internal, test-armed observation point at the physical state-sync send boundary.
 *
 * Normal runtime calls return before sampling transaction or pool state. There is no
 * configuration or external arming path: the one-shot gate is available only to
 * in-process Kotlin tests.
 */
@Service
class RoomRealtimeSendBoundaryProbe(
    private val dataSource: DataSource,
) {
    private val armedGate = AtomicReference<TestGate?>(null)

    internal fun armForTest(): TestGate {
        val gate = TestGate()
        check(armedGate.compareAndSet(null, gate)) { "A room realtime send-boundary probe is already armed" }
        return gate
    }

    fun observeImmediatelyBeforeStateSyncSend() {
        val gate = armedGate.getAndSet(null) ?: return
        val hikariPool = hikariPool()
        val observation = RoomRealtimeSendBoundaryObservation(
            transactionActive = TransactionSynchronizationManager.isActualTransactionActive(),
            hikariActive = hikariPool.activeConnections,
            hikariIdle = hikariPool.idleConnections,
        )
        gate.enter(observation)
    }

    private fun hikariPool() = runCatching {
        dataSource.unwrap(HikariDataSource::class.java)
    }.getOrNull()?.hikariPoolMXBean ?: (dataSource as? HikariDataSource)?.hikariPoolMXBean
        ?: error("Hikari datasource is required for the send-boundary probe")

    internal class TestGate {
        private val entered = CountDownLatch(1)
        private val release = CountDownLatch(1)

        @Volatile
        private var capturedObservation: RoomRealtimeSendBoundaryObservation? = null

        internal fun awaitEntered(timeout: Long, unit: TimeUnit): Boolean = entered.await(timeout, unit)

        internal fun observation(): RoomRealtimeSendBoundaryObservation =
            checkNotNull(capturedObservation) { "The send-boundary probe has not captured an observation" }

        internal fun release() {
            release.countDown()
        }

        internal fun enter(observation: RoomRealtimeSendBoundaryObservation) {
            capturedObservation = observation
            entered.countDown()
            try {
                release.await(5, TimeUnit.SECONDS)
            } catch (interrupted: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }
}

internal data class RoomRealtimeSendBoundaryObservation(
    val transactionActive: Boolean,
    val hikariActive: Int,
    val hikariIdle: Int,
)
