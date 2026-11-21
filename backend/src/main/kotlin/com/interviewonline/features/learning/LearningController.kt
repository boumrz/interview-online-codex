package com.interviewonline.features.learning

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.CollaborationService
import com.interviewonline.service.WorkspaceService
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.UUID

private const val LEARNING_VERSION = 2
private const val ONBOARDING_MODULE = "onboarding"
private const val ONBOARDING_WORKSPACE_STEPS = 6

data class LearningProgress(
    val module: String,
    val version: Int = LEARNING_VERSION,
    val revision: Long = 0,
    val offerSeen: Boolean = false,
    val skipped: Boolean = false,
    val status: String = "new",
    val attempt: Int = 0,
    val attemptType: String = "first",
    val completedSteps: Int = 0,
    val firstStartedAt: Instant? = null,
    val firstCompletedAt: Instant? = null,
    val completions: Int = 0,
)

data class LearningCommand(
    val commandId: UUID,
    val expectedRevision: Long,
    val action: String,
    val source: String,
    val step: Int? = null,
    val expectedVersion: Int = 1,
)

data class LearningResult(val state: LearningProgress, val events: List<String>)

@Service
class LearningService(
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val users: UserRepository,
    private val rooms: RoomRepository,
    private val collaboration: CollaborationService,
    private val workspaces: WorkspaceService,
) {
    private val steps = mapOf("personal_interviews" to 4, "team_interviews" to 4, "library" to 2,
        "candidates" to 2, "tracks" to 2, "team_settings" to 2, "room" to 8, ONBOARDING_MODULE to 14)

    private fun authorize(
        user: User, module: String, teamId: String?, inviteCode: String?, sessionId: String?,
        eventToken: String?, waitForRoom: Boolean, needsOnboardingRoom: Boolean = false,
    ) {
        if (module !in steps) throw ApiException(HttpStatus.NOT_FOUND, "Обучение недоступно")
        if (module == "room" || (module == ONBOARDING_MODULE && (needsOnboardingRoom || inviteCode != null))) {
            if (inviteCode.isNullOrBlank()) throw ApiException(HttpStatus.FORBIDDEN, "Откройте комнату интервьюера")
            val room = (if (waitForRoom) rooms.lockForSharedReadByInviteCode(inviteCode)
                else rooms.lockForImmediateSharedReadByInviteCode(inviteCode))
                ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната недоступна")
            if (room.archivedAt != null) throw ApiException(HttpStatus.NOT_FOUND, "Комната недоступна")
            if (sessionId.isNullOrBlank() || eventToken.isNullOrBlank()) throw ApiException(HttpStatus.FORBIDDEN, "Нет действующего подключения к комнате")
            val actor = collaboration.resolveCanvasParticipant(room, sessionId, eventToken, user)
            if (!actor.role.canManageRoom) throw ApiException(HttpStatus.FORBIDDEN, "Обучение доступно интервьюеру")
            return
        }
        if (teamId != null) {
            workspaces.teamDetail(user, teamId)
            if (module == "personal_interviews") throw ApiException(HttpStatus.FORBIDDEN, "Раздел недоступен")
        } else {
            if (module in setOf("team_interviews", "tracks", "team_settings")) throw ApiException(HttpStatus.FORBIDDEN, "Откройте раздел команды")
            if (module == "candidates" && !user.isHr) throw ApiException(HttpStatus.FORBIDDEN, "Раздел недоступен")
        }
    }

    private fun load(userId: String, module: String): LearningProgress = jdbc.query(
        "SELECT state_json FROM learning_progress_versions WHERE user_id = ? AND module = ? AND version = ?",
        { row, _ -> mapper.readValue<LearningProgress>(row.getString(1)) }, userId, module, LEARNING_VERSION,
    ).firstOrNull() ?: LearningProgress(module)

    @Transactional
    fun read(user: User, module: String, teamId: String?, inviteCode: String?, sessionId: String?, eventToken: String?): LearningProgress {
        authorize(user, module, teamId, inviteCode, sessionId, eventToken, waitForRoom = true)
        return load(requireNotNull(user.id), module)
    }

    @Transactional
    fun command(user: User, module: String, command: LearningCommand, teamId: String?, inviteCode: String?, sessionId: String?, eventToken: String?): LearningResult {
        val userId = requireNotNull(user.id)
        // Lock the account also for the first write, when there is no progress row yet.
        val currentUser = users.lockById(userId) ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Аккаунт недоступен")
        // Room membership updates may lock the room before the account. If the
        // room is busy, abort with a retryable 503 before waiting on that lock.
        val needsOnboardingRoom = command.action == "finish" ||
            (command.action == "step" && (command.step ?: 0) > ONBOARDING_WORKSPACE_STEPS)
        authorize(currentUser, module, teamId, inviteCode, sessionId, eventToken, waitForRoom = false,
            needsOnboardingRoom = needsOnboardingRoom)
        if (command.expectedVersion != LEARNING_VERSION) {
            throw ApiException(HttpStatus.CONFLICT, "Программа обучения обновилась. Перезагрузите страницу.", code = "LEARNING_VERSION_CHANGED")
        }
        val state = load(userId, module)
        val duplicate = jdbc.queryForObject(
            "SELECT COUNT(*) FROM learning_command_versions WHERE user_id = ? AND module = ? AND version = ? AND command_id = ?",
            Long::class.java, userId, module, LEARNING_VERSION, command.commandId,
        ) != 0L
        if (duplicate) return LearningResult(state, emptyList())
        if (command.expectedRevision != state.revision) throw ApiException(HttpStatus.CONFLICT, "Прогресс изменился в другой вкладке. Обновите обучение.")
        if (command.source !in setOf("offer", "help")) throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный источник обучения")
        val events = mutableListOf<String>()
        var next = state
        when (command.action) {
            "offer_seen" -> if (!state.offerSeen) {
                next = state.copy(offerSeen = true)
                events += "offer_seen"
            }
            "offer_skip" -> {
                val activeAttempt = state.status == "in_progress"
                val stopOnboarding = module == ONBOARDING_MODULE && activeAttempt
                if (stopOnboarding || (!state.skipped && (state.attempt == 0 || activeAttempt))) {
                    next = state.copy(offerSeen = true, skipped = true,
                        status = if (stopOnboarding) "cancelled" else state.status)
                    events += "offer_skip"
                }
            }
            "manual_open" -> events += "manual_open"
            "start" -> {
                if (state.status == "in_progress") throw ApiException(HttpStatus.CONFLICT, "Прохождение уже начато")
                val kind = when {
                    state.completions > 0 -> "replay"
                    state.attempt > 0 -> "retry"
                    else -> "first"
                }
                next = state.copy(offerSeen = true, status = "in_progress", attempt = state.attempt + 1,
                    attemptType = kind, completedSteps = 0, firstStartedAt = state.firstStartedAt ?: Instant.now())
                events += "${kind}_start"
                if (command.source == "help") events += "manual_start"
            }
            "resume" -> {
                requireStarted(state)
                events += "resume"
            }
            "cancel" -> {
                requireStarted(state)
                next = state.copy(status = "cancelled")
                events += "cancel"
            }
            "step" -> {
                requireStarted(state)
                if (command.step != state.completedSteps + 1 || command.step > steps.getValue(module)) {
                    throw ApiException(HttpStatus.CONFLICT, "Сначала выполните текущий шаг")
                }
                next = state.copy(completedSteps = command.step)
                events += "step_${command.step}"
            }
            "finish" -> {
                requireStarted(state)
                if (state.completedSteps != steps.getValue(module)) throw ApiException(HttpStatus.CONFLICT, "Сначала выполните шаги обучения")
                next = state.copy(status = "completed", completions = state.completions + 1,
                    firstCompletedAt = state.firstCompletedAt ?: Instant.now())
                events += if (state.completions == 0) "first_done" else "replay_done"
            }
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестное действие обучения")
        }
        next = next.copy(revision = state.revision + 1)
        jdbc.update("""
            INSERT INTO learning_progress_versions(user_id, module, version, state_json) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, module, version) DO UPDATE SET state_json = EXCLUDED.state_json
        """.trimIndent(), userId, module, LEARNING_VERSION, mapper.writeValueAsString(next))
        jdbc.update("INSERT INTO learning_command_versions(user_id, module, version, command_id) VALUES (?, ?, ?, ?)",
            userId, module, LEARNING_VERSION, command.commandId)
        return LearningResult(next, events)
    }

    private fun requireStarted(state: LearningProgress) {
        if (state.status != "in_progress") throw ApiException(HttpStatus.CONFLICT, "Начните прохождение")
    }
}

@RestController
@RequestMapping("/api/me/learning/{module}")
class LearningController(private val auth: AuthService, private val learning: LearningService) {
    @GetMapping
    fun read(
        @PathVariable module: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestParam(required = false) sessionId: String?,
        @RequestParam(required = false) teamId: String?,
        @RequestParam(required = false) inviteCode: String?,
    ): ResponseEntity<LearningProgress> = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
        learning.read(auth.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim()), module, teamId, inviteCode, sessionId, eventToken),
    )

    @PostMapping
    fun command(
        @PathVariable module: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestParam(required = false) sessionId: String?,
        @RequestParam(required = false) teamId: String?,
        @RequestParam(required = false) inviteCode: String?,
        @RequestBody command: LearningCommand,
    ): ResponseEntity<LearningResult> = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
        learning.command(auth.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim()), module, command, teamId, inviteCode, sessionId, eventToken),
    )
}
