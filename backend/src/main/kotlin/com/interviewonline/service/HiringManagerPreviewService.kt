package com.interviewonline.service

import com.interviewonline.dto.HiringManagerPreviewResponse
import com.interviewonline.dto.ResolveHiringManagerPreviewRequest
import com.interviewonline.repository.UserRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Service
class HiringManagerPreviewService(
    private val userRepository: UserRepository,
) {
    @Transactional(readOnly = true)
    fun resolve(request: ResolveHiringManagerPreviewRequest): HiringManagerPreviewResponse {
        val normalizedId = canonicalInvitationId(request.invitationId)
        val user = userRepository.findById(normalizedId).orElse(null)
            ?.takeIf { it.isHr }
            ?: throw unavailable()

        return HiringManagerPreviewResponse(
            normalizedId = normalizedId,
            displayName = user.displayName.orEmpty(),
        )
    }

    private fun canonicalInvitationId(rawInvitationId: String): String {
        val normalized = rawInvitationId.trim()
        val parsed = runCatching { UUID.fromString(normalized) }.getOrNull()
        if (normalized.isBlank() || parsed == null || !parsed.toString().equals(normalized, ignoreCase = true)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Некорректный идентификатор нанимающего")
        }
        return parsed.toString()
    }

    private fun unavailable(): ApiException = ApiException(
        HttpStatus.NOT_FOUND,
        "Нанимающий не найден или недоступен",
    )
}
