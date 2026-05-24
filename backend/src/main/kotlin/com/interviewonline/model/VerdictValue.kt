package com.interviewonline.model

enum class VerdictValue(val wireValue: String) {
    STRONG_HIRE("STRONG_HIRE"),
    HIRE("HIRE"),
    NO_HIRE("NO_HIRE"),
    STRONG_NO_HIRE("STRONG_NO_HIRE");

    companion object {
        fun fromWire(value: String): VerdictValue? =
            entries.find { it.wireValue.equals(value.trim(), ignoreCase = true) }
    }
}
