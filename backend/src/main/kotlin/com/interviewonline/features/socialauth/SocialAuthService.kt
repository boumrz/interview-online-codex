package com.interviewonline.features.socialauth

import com.interviewonline.dto.AuthResponse
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.UserTaskService
import com.interviewonline.service.CollaborationService
import com.interviewonline.service.RoomAccessService
import org.springframework.http.HttpStatus
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

class SocialStartResult(val authorizationUrl: String, val cookie: String)
data class SocialPendingResponse(val provider: String, val displayName: String, val accountExists: Boolean)
data class SocialCompleteRequest(val nickname: String? = null, val displayName: String? = null, val isHr: Boolean = false)
data class SocialStartRequest(val roomReturn: Boolean = false, val roomContextId: String? = null)
data class SocialRoomContextRequest(val roomId: String? = null, val inviteCode: String? = null)
class SocialRoomContextResult(val contextId: String, val cookie: String)
data class SocialRoomContextResponse(val contextId: String)
data class SocialContinueResponse(val path: String, val notice: String? = null)
data class SocialLinkRequest(val nickname: String = "", val password: String = "")
class SocialUnlinkRequest(val newPassword: String? = null)
data class SocialConnection(
    val provider: String,
    val linked: Boolean,
    val available: Boolean,
    val canUnlink: Boolean,
    val requiresPassword: Boolean,
)
data class SocialConnectionsResponse(val connections: List<SocialConnection>)
data class SocialProfileLinkResponse(val provider: String, val linked: Boolean = true)

private sealed interface RegistrationResult {
    data class AlreadyLinked(val identity: SocialAuthIdentityReference) : RegistrationResult
    data class SignedIn(val response: AuthResponse) : RegistrationResult
}

@Service
class SocialAuthService(
    private val settings: SocialAuthSettings,
    private val flows: SocialAuthFlowRepository,
    private val identities: SocialAuthIdentityRepository,
    private val sessionGuard: SocialAuthSessionGuardRepository,
    private val userGuard: SocialAuthUserGuardRepository,
    private val users: UserRepository,
    private val tasks: UserTaskService,
    private val auth: AuthService,
    private val providerClient: SocialProviderClient,
    private val rooms: RoomRepository,
    private val collaboration: CollaborationService,
    private val roomAccess: RoomAccessService,
    transactionManager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(transactionManager)
    fun providers() = settings.providers
    fun connections(token: String?): SocialConnectionsResponse {
        val user = auth.requireUserByToken(token)
        return connections(!user.passwordHash.isNullOrBlank(), hasGithubIdentity(requireNotNull(user.id)))
    }
    fun unlink(provider: String, token: String?, newPassword: String?): SocialConnectionsResponse {
        if (provider != GITHUB_SOCIAL_PROVIDER) throw providerUnavailable()
        return transaction.execute {
            val user = lockedSessionUser(token)
            val userId = requireNotNull(user.id)
            // The session lookup may have loaded the user before the row lock was acquired.
            val passwordHash = users.findLocalPasswordHash(userId)
            val hasPassword = passwordHash != null
            if (!hasGithubIdentity(userId)) {
                if (newPassword != null && (passwordHash == null || !auth.matchesInitialPassword(newPassword, passwordHash))) {
                    throw ApiException(HttpStatus.CONFLICT, "Связь уже снята. Обновите способы входа", code = "SOCIAL_CONNECTION_CHANGED")
                }
                return@execute connections(hasPassword, linked = false)
            }
            if (hasPassword && newPassword != null) throw passwordAlreadySet()
            if (!hasPassword) {
                val password = newPassword ?: throw ApiException(HttpStatus.CONFLICT,
                    "Установите пароль InterHub, чтобы отвязать аккаунт", code = "SOCIAL_PASSWORD_REQUIRED")
                val hash = auth.encodeInitialPassword(password)
                if (users.setInitialPassword(userId, hash) != 1) throw passwordAlreadySet()
            }
            // Keep the failed marker until expiry so an in-flight callback returns to the profile.
            flows.invalidateProfileLinks(userId, provider)
            identities.deleteProviderLinks(userId, provider)
            connections(hasPassword = true, linked = false)
        }!!
    }
    private fun passwordAlreadySet() = ApiException(HttpStatus.CONFLICT,
        "Пароль InterHub уже установлен. Подтвердите отвязку ещё раз", code = "SOCIAL_PASSWORD_ALREADY_SET")

    private fun hasGithubIdentity(userId: String) = identities.existsByUserIdAndProvider(userId, GITHUB_SOCIAL_PROVIDER)

    private fun connections(hasPassword: Boolean, linked: Boolean): SocialConnectionsResponse =
        SocialConnectionsResponse(listOf(SocialConnection(
            GITHUB_SOCIAL_PROVIDER, linked, settings.providers.isNotEmpty(), linked && hasPassword, linked && !hasPassword,
        )))

    fun startProfileLink(provider: String, token: String?): SocialStartResult {
        requireProvider(provider)
        val flowId = UUID.randomUUID().toString()
        val proof = SocialAuthSettings.randomProof()
        val state = SocialAuthSettings.randomProof()
        transaction.executeWithoutResult {
            val user = lockedSessionUser(token)
            if (identities.existsByUserIdAndProvider(requireNotNull(user.id), provider)) throw providerAlreadyLinked()
            flows.saveAndFlush(SocialAuthFlow(id = flowId, provider = provider, stateHash = SocialAuthSettings.hash(state),
                browserProofHash = SocialAuthSettings.hash(proof), expiresAt = Instant.now().plusSeconds(600),
                intent = "profile_link", initiatingUserId = user.id, initiatingSessionHash = SocialAuthSettings.hash(requireNotNull(token))))
        }
        return SocialStartResult(providerClient.authorizationUrl(flowId, proof, state), "$flowId.$proof")
    }
    fun completeProfileLink(cookie: String?, token: String?): SocialProfileLinkResponse {
        requireEnabled()
        return transaction.execute {
            // All linking paths lock the user before the flow and identity. This also
            // avoids a unique-subject insert waiting on its own user's foreign-key lock.
            val user = lockedSessionUser(token)
            val flow = validFlow(cookie, lock = true)
            requireProvider(flow.provider)
            if (flow.intent != "profile_link" || flow.initiatingUserId != user.id ||
                !constantEquals(flow.initiatingSessionHash.orEmpty(), SocialAuthSettings.hash(requireNotNull(token)))) throw invalid()
            if (flow.status == "LINKED" && identities.existsByUserIdAndProvider(requireNotNull(user.id), flow.provider)) {
                return@execute SocialProfileLinkResponse(flow.provider)
            }
            if (flow.status != "READY" || flow.subject == null) throw invalid()
            bindIdentity(flow.provider, requireNotNull(flow.subject), user)
            flow.status = "LINKED"
            flow.subject = null
            flow.displayName = null
            flows.saveAndFlush(flow)
            SocialProfileLinkResponse(flow.provider)
        }!!
    }
    private fun lockedSessionUser(token: String?): User {
        val actor = auth.requireUserByToken(token)
        val user = userGuard.lockById(requireNotNull(actor.id)) ?: throw invalid()
        val session = sessionGuard.lockByToken(requireNotNull(token)) ?: throw invalid()
        if (session.user?.id != user.id) throw invalid()
        return user
    }
    fun isProfileLinkCallback(cookie: String?): Boolean = runCatching {
        val (id, proof) = splitProof(cookie)
        val flow = flows.findById(id).orElse(null)
        // Only a fixed destination is selected, including for expired attempts.
        // No query parameter or unverified browser can select a profile result.
        flow != null && flow.provider in settings.providers &&
            flow.intent == "profile_link" && constantEquals(flow.browserProofHash, SocialAuthSettings.hash(proof))
    }.getOrDefault(false)
    fun requireOrigin(origin: String?) {
        requireEnabled()
        requireTrustedOrigin(origin)
    }
    fun requireTrustedOrigin(origin: String?) {
        if (!settings.matchesOrigin(origin)) throw ApiException(HttpStatus.FORBIDDEN, "Откройте вход на странице приложения", code = "SOCIAL_ORIGIN_REQUIRED")
    }
    fun roomContext(request: SocialRoomContextRequest, eventToken: String?): SocialRoomContextResult {
        requireEnabled()
        val proof = SocialAuthSettings.randomProof()
        val id = UUID.randomUUID().toString()
        transaction.executeWithoutResult {
            val room = when {
                !request.inviteCode.isNullOrBlank() && request.roomId == null && eventToken == null ->
                    rooms.findByInviteCode(request.inviteCode)
                !request.roomId.isNullOrBlank() && request.inviteCode == null && !eventToken.isNullOrBlank() ->
                    rooms.findById(request.roomId).orElse(null)
                else -> null
            } ?: throw roomContextDenied()
            if (room.archivedAt != null) throw roomContextDenied()
            if (request.inviteCode != null) {
                roomAccess.resolveAccess(room, user = null)
            } else if (collaboration.resolveRoleByEventToken(room.inviteCode, eventToken) == null) {
                throw roomContextDenied()
            }
            flows.saveAndFlush(SocialAuthFlow(id = id, provider = "", stateHash = SocialAuthSettings.hash(SocialAuthSettings.randomProof()),
                browserProofHash = SocialAuthSettings.hash(proof), status = "CONTEXT", expiresAt = Instant.now().plusSeconds(600),
                returnRequested = true, returnRoomId = room.id, returnTeamId = room.teamId,
                returnInviteHash = SocialAuthSettings.hash(room.inviteCode)))
        }
        return SocialRoomContextResult(id, "$id.$proof")
    }
    private fun roomContextDenied() = ApiException(HttpStatus.FORBIDDEN, "Нет действующего доступа к комнате")
    fun start(provider: String, cookie: String? = null, request: SocialStartRequest = SocialStartRequest()): SocialStartResult {
        requireProvider(provider)
        val flowId = UUID.randomUUID().toString()
        val proof = SocialAuthSettings.randomProof()
        val state = SocialAuthSettings.randomProof()
        transaction.executeWithoutResult {
            val context = if (request.roomReturn && request.roomContextId != null) {
                runCatching { validFlow(cookie, lock = true) }.getOrNull()
                    ?.takeIf { it.status == "CONTEXT" && it.id == request.roomContextId }
            } else null
            flows.deleteExpired(Instant.now())
            flows.saveAndFlush(SocialAuthFlow(id = flowId, provider = provider, stateHash = SocialAuthSettings.hash(state),
                browserProofHash = SocialAuthSettings.hash(proof), expiresAt = Instant.now().plusSeconds(600),
                returnRequested = request.roomReturn, returnRoomId = context?.returnRoomId, returnTeamId = context?.returnTeamId,
                returnInviteHash = context?.returnInviteHash))
            context?.let { flows.delete(it) }
        }
        return SocialStartResult(providerClient.authorizationUrl(flowId, proof, state), "$flowId.$proof")
    }
    fun callback(provider: String, cookie: String?, state: String?, code: String?, error: String?): Boolean {
        requireProvider(provider)
        val (_, proof) = splitProof(cookie)
        val flow = transaction.execute {
            val stored = validFlow(cookie, lock = true)
            if (stored.provider != provider || stored.status != "CREATED" || state == null || !constantEquals(stored.stateHash, SocialAuthSettings.hash(state))) throw invalid()
            if (error != null) {
                stored.status = "FAILED"; flows.saveAndFlush(stored); return@execute null
            }
            if (code.isNullOrBlank() || code.length > 2048) throw invalid()
            stored.status = "EXCHANGING"
            flows.saveAndFlush(stored)
        } ?: return false
        val identity = try {
            providerClient.exchange(flow.id, proof, requireNotNull(code))
        } catch (_: Exception) {
            markFailed(flow.id)
            throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Не удалось подтвердить вход через провайдера. Попробуйте снова", code = "SOCIAL_PROVIDER_UNAVAILABLE")
        }
        transaction.executeWithoutResult {
            val current = flows.lockById(flow.id) ?: throw invalid()
            if (current.status != "EXCHANGING" || !current.expiresAt.isAfter(Instant.now())) throw invalid()
            current.subject = identity.subject; current.displayName = identity.displayName; current.status = "READY"
            flows.saveAndFlush(current)
        }
        return true
    }
    fun pending(cookie: String?): SocialPendingResponse {
        requireEnabled()
        return transaction.execute {
            val flow = readyFlow(cookie, lock = false)
            SocialPendingResponse(flow.provider, flow.displayName.orEmpty(), identities.findByProviderAndSubject(flow.provider, requireNotNull(flow.subject)) != null)
        }!!
    }
    fun complete(cookie: String?, request: SocialCompleteRequest): AuthResponse {
        requireEnabled()
        // Discover the owner without a write lock. Existing login must acquire the user before the flow.
        val linked = transaction.execute { findLoginIdentity(readyFlow(cookie, lock = false)) }
        if (linked != null) return completeExistingLogin(cookie, linked)

        val registration = transaction.execute<RegistrationResult> {
            val flow = readyFlow(cookie, lock = true)
            // A concurrent registration or attach may have won since discovery.
            // Release this flow lock before attempting to sign in under the owner's lock.
            val existing = findLoginIdentity(flow)
            if (existing != null) return@execute RegistrationResult.AlreadyLinked(existing)

            val subject = requireNotNull(flow.subject)
            val nickname = request.nickname?.trim().orEmpty()
            val name = request.displayName?.trim().orEmpty()
            validateProfile(nickname, name)
            if (users.findByNickname(nickname) != null) throw ApiException(HttpStatus.CONFLICT, "Ник уже занят", code = "NICKNAME_TAKEN")
            val userId = UUID.randomUUID().toString()
            if (users.insertSocialUserIfAbsent(userId, nickname, name, request.isHr, Instant.now()) == 0) {
                throw ApiException(HttpStatus.CONFLICT, "Ник уже занят", code = "NICKNAME_TAKEN")
            }
            val created = users.findById(userId).orElseThrow()
            tasks.initializeTaskBank(created)
            if (!insertIdentity(flow.provider, subject, created)) throw identityConflict()
            RegistrationResult.SignedIn(consume(flow, created))
        }!!
        return when (registration) {
            is RegistrationResult.AlreadyLinked -> completeExistingLogin(cookie, registration.identity)
            is RegistrationResult.SignedIn -> registration.response
        }
    }
    private fun completeExistingLogin(cookie: String?, expected: SocialAuthIdentityReference): AuthResponse = transaction.execute {
        val user = userGuard.lockById(expected.userId) ?: throw invalid()
        val flow = readyFlow(cookie, lock = true)
        if (findLoginIdentity(flow) != expected) throw invalid()
        consume(flow, user)
    }!!
    private fun findLoginIdentity(flow: SocialAuthFlow): SocialAuthIdentityReference? =
        identities.findReference(flow.provider, requireNotNull(flow.subject))

    fun link(cookie: String?, request: SocialLinkRequest): AuthResponse {
        requireEnabled()
        return transaction.execute {
            val verified = auth.verifyLocalCredentials(request.nickname, request.password)
            val user = userGuard.lockById(requireNotNull(verified.id)) ?: throw invalid()
            val flow = readyFlow(cookie, lock = true)
            bindIdentity(flow.provider, requireNotNull(flow.subject), user)
            consume(flow, user)
        }!!
    }
    private fun bindIdentity(provider: String, subject: String, user: User) {
        val existing = identities.findByProviderAndSubject(provider, subject)
        if (existing != null) {
            if (existing.user?.id != user.id) throw identityConflict()
            return
        }
        if (identities.existsByUserIdAndProvider(requireNotNull(user.id), provider)) throw providerAlreadyLinked()
        if (!insertIdentity(provider, subject, user)) {
            val winner = identities.findByProviderAndSubject(provider, subject)
            if (winner?.user?.id != user.id) throw identityConflict()
        }
    }
    private fun providerAlreadyLinked() = ApiException(HttpStatus.CONFLICT,
        "Этот сервис уже подключён. Заменить подключённый аккаунт нельзя", code = "SOCIAL_PROVIDER_ALREADY_LINKED")
    private fun insertIdentity(provider: String, subject: String, user: User): Boolean =
        identities.insertIfAbsent(UUID.randomUUID().toString(), provider, subject, requireNotNull(user.id), Instant.now()) == 1

    private fun identityConflict() = ApiException(HttpStatus.CONFLICT,
        "Этот аккаунт уже привязан к другому профилю InterHub. Сначала отвяжите его в разделе «Способы входа» того профиля.",
        code = "SOCIAL_IDENTITY_CONFLICT")

    private fun consume(flow: SocialAuthFlow, user: User): AuthResponse {
        flow.status = "COMPLETED"
        // Drop provider profile metadata immediately after the one-use completion.
        flow.subject = null; flow.displayName = null
        val session = auth.createSession(user)
        flow.completedSessionHash = SocialAuthSettings.hash(session.token)
        flows.saveAndFlush(flow)
        return session
    }
    fun continueToRoom(cookie: String?, token: String?): SocialContinueResponse {
        requireEnabled()
        val user = auth.requireUserByToken(token)
        return transaction.execute {
            val flow = validFlow(cookie, lock = true)
            requireProvider(flow.provider)
            if (flow.intent != "login" || flow.status != "COMPLETED" || !constantEquals(flow.completedSessionHash.orEmpty(), SocialAuthSettings.hash(requireNotNull(token)))) throw invalid()
            val room = flow.returnRoomId?.let { rooms.findById(it).orElse(null) }
            val roomAvailable = room != null && room.archivedAt == null && room.teamId == flow.returnTeamId &&
                SocialAuthSettings.hash(room.inviteCode) == flow.returnInviteHash
            val result = if (roomAvailable) {
                roomAccess.resolveAccess(requireNotNull(room), user)
                SocialContinueResponse("/room/${room.inviteCode}")
            } else SocialContinueResponse("/workspace/personal/interviews", if (flow.returnRequested)
                "Возврат в комнату недоступен. Откройте действующее приглашение ещё раз." else null)
            flow.status = "RETURNED"
            flow.returnRoomId = null
            flow.returnTeamId = null
            flow.returnInviteHash = null
            flow.completedSessionHash = null
            flows.saveAndFlush(flow)
            result
        }!!
    }
    private fun validateProfile(nickname: String, name: String) {
        if (nickname.length !in 3..32) throw ApiException(HttpStatus.BAD_REQUEST, "Ник должен быть от 3 до 32 символов", code = "INVALID_REQUEST")
        if (nickname.any { it.isWhitespace() }) throw ApiException(HttpStatus.BAD_REQUEST, "Ник не должен содержать пробелы", code = "INVALID_REQUEST")
        if (nickname.any { it.code !in 0x20..0x7E }) throw ApiException(HttpStatus.BAD_REQUEST, "Ник может содержать только латинские буквы, цифры и символы", code = "INVALID_REQUEST")
        if (nickname.equals("boumrz", ignoreCase = true)) throw ApiException(HttpStatus.BAD_REQUEST, "Этот ник недоступен", code = "INVALID_REQUEST")
        if (name.length !in 2..64) throw ApiException(HttpStatus.BAD_REQUEST, "Имя должно быть от 2 до 64 символов", code = "INVALID_REQUEST")
    }
    private fun readyFlow(cookie: String?, lock: Boolean): SocialAuthFlow = validFlow(cookie, lock).also {
        requireProvider(it.provider)
        if (it.intent != "login" || it.status != "READY" || it.subject == null) throw invalid()
    }
    private fun validFlow(cookie: String?, lock: Boolean): SocialAuthFlow {
        val (id, proof) = splitProof(cookie)
        val flow = if (lock) flows.lockById(id) else flows.findById(id).orElse(null)
        if (flow == null || !flow.expiresAt.isAfter(Instant.now()) || !constantEquals(flow.browserProofHash, SocialAuthSettings.hash(proof))) throw invalid()
        return flow
    }
    private fun splitProof(cookie: String?): Pair<String, String> {
        val parts = cookie?.split('.') ?: throw invalid()
        if (parts.size != 2 || !parts[0].matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) || !parts[1].matches(Regex("[A-Za-z0-9_-]{43}"))) throw invalid()
        return parts[0] to parts[1]
    }
    private fun markFailed(id: String) { transaction.executeWithoutResult { flows.lockById(id)?.let { it.status = "FAILED"; it.subject = null; it.displayName = null; flows.saveAndFlush(it) } } }
    private fun requireProvider(provider: String) {
        requireEnabled()
        if (provider !in settings.providers) throw providerUnavailable()
    }
    private fun providerUnavailable() = ApiException(HttpStatus.NOT_FOUND, "Вход через этого провайдера недоступен", code = "SOCIAL_PROVIDER_DISABLED")
    private fun requireEnabled() {
        if (settings.providers.isEmpty()) throw ApiException(HttpStatus.NOT_FOUND, "Вход через провайдера недоступен", code = "SOCIAL_AUTH_DISABLED")
    }
    private fun invalid() = ApiException(HttpStatus.UNAUTHORIZED, "Попытка входа недействительна или истекла. Начните вход заново", code = "SOCIAL_AUTH_EXPIRED")
    private fun constantEquals(first: String, second: String) = MessageDigest.isEqual(first.toByteArray(StandardCharsets.US_ASCII), second.toByteArray(StandardCharsets.US_ASCII))
    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    fun cleanupExpired() { runCatching { transaction.executeWithoutResult { flows.deleteExpired(Instant.now()) } } }
}
