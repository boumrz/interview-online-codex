package com.interviewonline.features.socialauth

import com.interviewonline.dto.AuthResponse
import com.interviewonline.model.User
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.UserTaskService
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
data class SocialLinkRequest(val nickname: String = "", val password: String = "")

@Service
class SocialAuthService(
    private val settings: SocialAuthSettings,
    private val flows: SocialAuthFlowRepository,
    private val identities: SocialAuthIdentityRepository,
    private val users: UserRepository,
    private val tasks: UserTaskService,
    private val auth: AuthService,
    private val providerClient: SocialProviderClient,
    transactionManager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(transactionManager)
    fun providers() = settings.providers
    fun requireOrigin(origin: String?) {
        requireEnabled()
        if (origin != settings.origin) throw ApiException(HttpStatus.FORBIDDEN, "Откройте вход на странице приложения", code = "SOCIAL_ORIGIN_REQUIRED")
    }
    fun start(provider: String): SocialStartResult {
        requireProvider(provider)
        val flowId = UUID.randomUUID().toString()
        val proof = SocialAuthSettings.randomProof()
        val state = SocialAuthSettings.randomProof()
        transaction.executeWithoutResult {
            flows.deleteExpired(Instant.now())
            flows.saveAndFlush(SocialAuthFlow(id = flowId, provider = provider, stateHash = SocialAuthSettings.hash(state),
                browserProofHash = SocialAuthSettings.hash(proof), expiresAt = Instant.now().plusSeconds(600)))
        }
        return SocialStartResult(providerClient.authorizationUrl(provider, flowId, proof, state), "$flowId.$proof")
    }
    fun callback(provider: String, cookie: String?, state: String?, code: String?, deviceId: String?, error: String?): Boolean {
        requireProvider(provider)
        val (_, proof) = splitProof(cookie)
        val flow = transaction.execute {
            val stored = validFlow(cookie, lock = true)
            if (stored.provider != provider || stored.status != "CREATED" || state == null || !constantEquals(stored.stateHash, SocialAuthSettings.hash(state))) throw invalid()
            if (error != null) {
                stored.status = "FAILED"; flows.saveAndFlush(stored); return@execute null
            }
            if (code.isNullOrBlank() || code.length > 2048 || (provider == "vk" && (deviceId.isNullOrBlank() || deviceId.length > 512))) throw invalid()
            stored.status = "EXCHANGING"
            flows.saveAndFlush(stored)
        } ?: return false
        val identity = try {
            providerClient.exchange(provider, flow.id, proof, requireNotNull(code), requireNotNull(state), deviceId)
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
        return transaction.execute {
            val flow = readyFlow(cookie, lock = true)
            val subject = requireNotNull(flow.subject)
            val existing = identities.findByProviderAndSubject(flow.provider, subject)
            val user = if (existing != null) requireNotNull(existing.user) else {
                val nickname = request.nickname?.trim().orEmpty()
                val name = request.displayName?.trim().orEmpty()
                validateProfile(nickname, name)
                if (users.findByNickname(nickname) != null) throw ApiException(HttpStatus.CONFLICT, "Ник уже занят", code = "NICKNAME_TAKEN")
                val created = users.saveAndFlush(User(nickname = nickname, displayName = name, passwordHash = null, role = "user", isHr = request.isHr))
                tasks.initializeTaskBank(created)
                identities.saveAndFlush(SocialAuthIdentity(provider = flow.provider, subject = subject, user = created))
                created
            }
            consume(flow, user)
        }!!
    }
    fun link(cookie: String?, request: SocialLinkRequest): AuthResponse {
        requireEnabled()
        return transaction.execute {
            val flow = readyFlow(cookie, lock = true)
            val user = auth.verifyLocalCredentials(request.nickname, request.password)
            val subject = requireNotNull(flow.subject)
            val existing = identities.findByProviderAndSubject(flow.provider, subject)
            if (existing != null && existing.user?.id != user.id) throw ApiException(HttpStatus.CONFLICT, "Этот аккаунт провайдера уже привязан к другому пользователю", code = "SOCIAL_IDENTITY_CONFLICT")
            if (existing == null) identities.saveAndFlush(SocialAuthIdentity(provider = flow.provider, subject = subject, user = user))
            consume(flow, user)
        }!!
    }
    private fun consume(flow: SocialAuthFlow, user: User): AuthResponse {
        flow.status = "COMPLETED"
        // Drop provider profile metadata immediately after the one-use completion.
        flow.subject = null; flow.displayName = null
        flows.saveAndFlush(flow)
        return auth.createSession(user)
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
        if (it.status != "READY" || it.subject == null) throw invalid()
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
        if (provider !in settings.providers) throw ApiException(HttpStatus.NOT_FOUND, "Вход через этого провайдера недоступен", code = "SOCIAL_PROVIDER_DISABLED")
    }
    private fun requireEnabled() {
        if (!settings.enabled) throw ApiException(HttpStatus.NOT_FOUND, "Вход через провайдера недоступен", code = "SOCIAL_AUTH_DISABLED")
    }
    private fun invalid() = ApiException(HttpStatus.UNAUTHORIZED, "Попытка входа недействительна или истекла. Начните вход заново", code = "SOCIAL_AUTH_EXPIRED")
    private fun constantEquals(first: String, second: String) = MessageDigest.isEqual(first.toByteArray(StandardCharsets.US_ASCII), second.toByteArray(StandardCharsets.US_ASCII))
    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    fun cleanupExpired() { runCatching { transaction.executeWithoutResult { flows.deleteExpired(Instant.now()) } } }
}
