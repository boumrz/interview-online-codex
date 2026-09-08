package com.interviewonline.dto

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonDeserializer
import com.fasterxml.jackson.databind.JsonMappingException
import com.fasterxml.jackson.databind.annotation.JsonDeserialize

/**
 * The request deliberately accepts one UUID only. Keeping this boundary
 * strict prevents the preview endpoint from becoming a directory/search API.
 */
@JsonDeserialize(using = ResolveHiringManagerPreviewRequestDeserializer::class)
data class ResolveHiringManagerPreviewRequest(
    val invitationId: String,
)

class ResolveHiringManagerPreviewRequestDeserializer : JsonDeserializer<ResolveHiringManagerPreviewRequest>() {
    override fun deserialize(
        parser: JsonParser,
        context: DeserializationContext,
    ): ResolveHiringManagerPreviewRequest {
        val firstToken = parser.currentToken ?: parser.nextToken()
        if (firstToken != JsonToken.START_OBJECT) throw malformed(parser)

        var invitationId: String? = null
        while (true) {
            val fieldToken = parser.nextToken() ?: throw malformed(parser)
            if (fieldToken == JsonToken.END_OBJECT) break
            if (fieldToken != JsonToken.FIELD_NAME || parser.currentName() != "invitationId" || invitationId != null) {
                throw malformed(parser)
            }
            if (parser.nextToken() != JsonToken.VALUE_STRING) throw malformed(parser)
            invitationId = parser.text
        }

        return ResolveHiringManagerPreviewRequest(invitationId ?: throw malformed(parser))
    }

    override fun getNullValue(context: DeserializationContext): ResolveHiringManagerPreviewRequest {
        throw malformed(context.parser)
    }

    private fun malformed(parser: JsonParser): JsonMappingException =
        JsonMappingException.from(parser, "Ожидается только строковое поле invitationId")
}

data class HiringManagerPreviewResponse(
    val normalizedId: String,
    val displayName: String,
)
