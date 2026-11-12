package com.interviewonline.service

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** Visual defaults only; drawing colors never grant access or identify an author for authorization. */
@Service
class RoomDrawingColorService(private val jdbc: JdbcTemplate) {
    @Transactional
    fun forParticipant(roomId: String, userId: String?, participantId: String?, sessionId: String): String {
        // Admission already owns this lock. Taking it here as well makes this
        // allocator safe for every caller and serializes identities across nodes.
        check(jdbc.queryForList("SELECT id FROM rooms WHERE id=? FOR UPDATE", String::class.java, roomId).isNotEmpty())
        val identity = ParticipantIdentity.participantIdentityKey(userId, participantId, sessionId)
        jdbc.queryForList("SELECT color FROM room_drawing_colors WHERE room_id=? AND identity_key=?", String::class.java, roomId, identity)
            .firstOrNull()?.let { return it }
        val used = jdbc.queryForList("SELECT color FROM room_drawing_colors WHERE room_id=?", String::class.java, roomId).toHashSet()
        val color = PALETTE.firstOrNull { it !in used } ?: generatedColor(used)
        jdbc.update("INSERT INTO room_drawing_colors(room_id,identity_key,color) VALUES (?,?,?)", roomId, identity, color)
        return color
    }

    private fun generatedColor(used: Set<String>): String {
        // Multiplication by an odd number permutes all 24-bit RGB values. Unlike
        // a wrapping palette, this visits each candidate once and skips every
        // reservation. Exclude nearly gray and very light/dark ink for readability.
        for (index in 0 until (1 shl 24)) {
            val rgb = ((index.toLong() * 0x9e3779L + 0x406080L) and 0xffffffL).toInt()
            val red = (rgb shr 16) and 255
            val green = (rgb shr 8) and 255
            val blue = rgb and 255
            val luminance = (54 * red + 183 * green + 19 * blue) shr 8
            if (luminance !in 65..175 || maxOf(red, green, blue) - minOf(red, green, blue) < 50) continue
            val color = "#" + rgb.toString(16).padStart(6, '0')
            if (color !in used) return color
        }
        error("No unused drawing color remains")
    }

    private companion object {
        val PALETTE = listOf("#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2",
            "#be185d", "#4f46e5", "#65a30d", "#a16207", "#0d9488", "#c026d3")
    }
}
