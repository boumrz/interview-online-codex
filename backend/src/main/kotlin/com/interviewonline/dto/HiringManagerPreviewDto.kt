package com.interviewonline.dto

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonDeserializer
import com.fasterxml.jackson.databind.JsonMappingException
import com.fasterxml.jackson.databind.annotation.JsonDeserialize

/**
 * The request accepts one target UUID and an optional team scope. It cannot
 * be used as a directory/search API.
 */
@JsonDeserialize(using = ResolveHiringManagerPreviewRequestDeserializer::class)
data class ResolveHiringManagerPreviewRequest(
    val invitationId: String,
    val teamId: String? = null,
)

class ResolveHiringManagerPreviewRequestDeserializer : JsonDeserializer<ResolveHiringManagerPreviewRequest>() {
    override fun deserialize(
        parser: JsonParser,
        context: DeserializationContext,
    ): ResolveHiringManagerPreviewRequest {
        val firstToken = parser.currentToken ?: parser.nextToken()
        if (firstToken != JsonToken.START_OBJECT) throw malformed(parser)

        var invitationId: String? = null
        var teamId: String? = null
        val fields = mutableSetOf<String>()
        while (true) {
            val fieldToken = parser.nextToken() ?: throw malformed(parser)
            if (fieldToken == JsonToken.END_OBJECT) break
            val name = parser.currentName()
            if (fieldToken != JsonToken.FIELD_NAME || name !in setOf("invitationId", "teamId") || !fields.add(name)) {
                throw malformed(parser)
            }
            val valueToken = parser.nextToken()
            if (valueToken == JsonToken.VALUE_NULL && name == "teamId") continue
            if (valueToken != JsonToken.VALUE_STRING) throw malformed(parser)
            if (name == "invitationId") invitationId = parser.text else teamId = parser.text
        }

        return ResolveHiringManagerPreviewRequest(invitationId ?: throw malformed(parser), teamId)
    }

    override fun getNullValue(context: DeserializationContext): ResolveHiringManagerPreviewRequest {
        throw malformed(context.parser)
    }

    private fun malformed(parser: JsonParser): JsonMappingException =
        JsonMappingException.from(parser, "Ожидается строковое поле invitationId и необязательное поле teamId")
}

data class HiringManagerPreviewResponse(
    val normalizedId: String,
    val displayName: String,
)
