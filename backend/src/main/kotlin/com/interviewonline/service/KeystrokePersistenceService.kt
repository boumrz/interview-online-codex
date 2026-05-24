package com.interviewonline.service

import com.interviewonline.model.RoomKeystrokeEvent
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.ws.CandidateKeyPayload
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@Service
class KeystrokePersistenceService(
    private val roomKeystrokeEventRepository: RoomKeystrokeEventRepository,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val batchSize = 100
    private val pendingByRoom = ConcurrentHashMap<String, ConcurrentLinkedQueue<RoomKeystrokeEvent>>()
    private val flushScheduler = Executors.newSingleThreadScheduledExecutor()

    init {
        flushScheduler.scheduleWithFixedDelay(
            { flushAll() },
            5L, 5L, TimeUnit.SECONDS,
        )
    }

    fun enqueue(roomId: String, payload: CandidateKeyPayload) {
        val event = RoomKeystrokeEvent(
            roomId = roomId,
            sessionId = payload.sessionId,
            displayName = payload.displayName,
            keyValue = payload.key.ifBlank { null },
            keyCode = payload.keyCode.ifBlank { null },
            ctrlKey = payload.ctrlKey,
            altKey = payload.altKey,
            shiftKey = payload.shiftKey,
            metaKey = payload.metaKey,
            eventKind = payload.eventKind,
            pasteLength = payload.pasteLength,
            pastePreview = payload.pastePreview,
            timestampEpochMs = payload.timestampEpochMs,
        )
        val queue = pendingByRoom.computeIfAbsent(roomId) { ConcurrentLinkedQueue() }
        queue.add(event)
        if (queue.size >= batchSize) {
            flushRoom(roomId, queue)
        }
    }

    private fun flushAll() {
        pendingByRoom.keys.forEach { roomId ->
            val queue = pendingByRoom[roomId] ?: return@forEach
            if (queue.isNotEmpty()) {
                flushRoom(roomId, queue)
            }
        }
    }

    private fun flushRoom(roomId: String, queue: ConcurrentLinkedQueue<RoomKeystrokeEvent>) {
        val batch = mutableListOf<RoomKeystrokeEvent>()
        var event = queue.poll()
        while (event != null) {
            batch.add(event)
            event = queue.poll()
        }
        if (batch.isEmpty()) return
        try {
            // Spring Data JpaRepository.saveAll() is already @Transactional via SimpleJpaRepository.
            // Calling it directly (not through a self-proxy) is the correct pattern here.
            roomKeystrokeEventRepository.saveAll(batch)
            logger.debug("Flushed {} keystroke events for room {}", batch.size, roomId)
        } catch (ex: Exception) {
            logger.warn(
                "Keystroke batch flush failed for room {} ({} events) — re-enqueuing for next cycle",
                roomId, batch.size, ex,
            )
            // Re-add to the room's queue so the next periodic flush retries them.
            // The DB orders by timestamp_epoch_ms, so FIFO insertion order doesn't matter.
            val retryQueue = pendingByRoom.computeIfAbsent(roomId) { ConcurrentLinkedQueue() }
            batch.forEach { retryQueue.offer(it) }
        }
    }

    @PreDestroy
    fun shutdown() {
        flushScheduler.shutdown()
        flushAll()
    }
}
