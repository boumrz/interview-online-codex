package com.interviewonline.service

/**
 * Унификация маппинга «человекочитаемое имя языка → канонический ключ»,
 * используемый и в БД (Room.language, RoomTask.solutionLanguage), и в API.
 *
 * Раньше было четыре копии в [TaskTemplateService], [RoomService],
 * [UserTaskService] и [CollaborationService] — две из них использовали
 * `.trim().lowercase()`, две — только `.lowercase()`. Унифицировано до
 * defensive-варианта `.trim().lowercase()`, чтобы пробелы по краям не
 * приводили к неожиданному скатыванию в дефолтный язык (`nodejs`).
 */
internal object LanguageNormalizer {

    private const val DEFAULT_LANGUAGE: String = "nodejs"

    fun normalize(language: String): String =
        when (language.trim().lowercase()) {
            "javascript", "typescript", "nodejs" -> "nodejs"
            "python" -> "python"
            "kotlin" -> "kotlin"
            "java" -> "java"
            "sql" -> "sql"
            // `plaintext` — синтетический "не-язык" для задач без
            // привязки к синтаксису. Бэкенд хранит его как обычную
            // строку и не пытается выполнять код в раннере.
            "plaintext", "plain-text", "plain_text", "plain", "text", "txt", "none" -> "plaintext"
            else -> DEFAULT_LANGUAGE
        }
}
