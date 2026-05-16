package com.interviewonline.service

/**
 * Чистые помощники, описывающие, как мы идентифицируем участников комнаты
 * и сравниваем их роли.
 *
 * Раньше жили внутри [CollaborationService] — выделены, чтобы:
 * - стало понятнее, что эта группа функций образует одну смысловую единицу
 *   (identity участника + его «вес» по роли),
 * - можно было свободно переиспользовать в других сервисах/тестах без
 *   тяги за всем сервисом.
 *
 * Здесь нет состояния и нет обращений к репозиториям. Все методы — `internal`,
 * чтобы оставить их в рамках сервисного пакета.
 */
internal object ParticipantIdentity {
    /** Максимальная длина «participantId» в идентификаторах гостей. */
    const val PARTICIPANT_ID_MAX_LENGTH: Int = 128

    /**
     * Нормализует входящий `participantId`: тримит, режет до 128 символов,
     * возвращает `null` для пустых значений. Гарантирует, что в любых
     * идентификационных ключах не «всплывут» строки c whitespace в начале.
     */
    fun normalizeParticipantId(participantId: String?): String? {
        val normalized = participantId?.trim().orEmpty()
        if (normalized.isBlank()) return null
        return normalized.take(PARTICIPANT_ID_MAX_LENGTH)
    }

    /**
     * Стабильный ключ идентичности участника:
     * - `user:<id>` для авторизованных пользователей,
     * - `guest:<participantId>` для гостей с привязкой через participantId,
     * - `session:<sessionId>` как фолбэк (свежая анонимная вкладка).
     *
     * Используется для группировки нескольких подключений (вкладок) одного
     * человека в один ParticipantPayload и для проверки прав.
     */
    fun participantIdentityKey(
        userId: String?,
        participantId: String?,
        sessionId: String,
    ): String {
        val normalizedUserId = userId?.trim().orEmpty()
        if (normalizedUserId.isNotBlank()) {
            return "user:$normalizedUserId"
        }
        val normalizedParticipantId = normalizeParticipantId(participantId)
        if (normalizedParticipantId != null) {
            return "guest:$normalizedParticipantId"
        }
        return "session:$sessionId"
    }

    /**
     * Числовой «вес» роли — выше число, выше приоритет. Используется при
     * слиянии участников из нескольких вкладок и при выборе representative
     * для отображения в UI.
     */
    fun rolePriority(role: RoomAccessService.RoomRole): Int = when (role) {
        RoomAccessService.RoomRole.OWNER -> 3
        RoomAccessService.RoomRole.INTERVIEWER -> 2
        RoomAccessService.RoomRole.CANDIDATE -> 1
    }
}
