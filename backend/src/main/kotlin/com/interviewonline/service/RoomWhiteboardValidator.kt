package com.interviewonline.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.RoomWhiteboardChangeRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

@Component
class RoomWhiteboardValidator(private val mapper: ObjectMapper) {
    fun readRequest(body: JsonNode): RoomWhiteboardChangeRequest {
        requireValid(mapper.writeValueAsBytes(body).size <= MAX_OPERATION_BYTES)
        objectFields(body, setOf("boardId", "operationId", "baseSequence", "elements"))
        val boardId = uuid(body.path("boardId"))
        val operationId = uuid(body.path("operationId"))
        val base = integer(body.path("baseSequence"), 0, MAX_SAFE_INTEGER)
        val elements = body.path("elements")
        requireValid(elements.isArray && elements.size() in 1..MAX_ELEMENTS)
        val changes = elements.toList()
        requireValid(changes.map { it.path("id").asText() }.distinct().size == changes.size)
        changes.forEach(::validateElement)
        requireValid(pointCount(changes) <= MAX_TOTAL_POINTS)
        return RoomWhiteboardChangeRequest(boardId, operationId, base, changes)
    }

    fun validateScene(elements: List<JsonNode>) {
        requireValid(elements.size <= MAX_ELEMENTS && pointCount(elements) <= MAX_TOTAL_POINTS)
        requireValid(mapper.writeValueAsBytes(elements).size <= MAX_SCENE_BYTES)
    }

    /** Object key order is not part of a retry's identity; array order is. */
    fun canonical(node: JsonNode): JsonNode = when {
        node.isObject -> mapper.createObjectNode().also { sorted ->
            node.fieldNames().asSequence().sorted().forEach { sorted.set<JsonNode>(it, canonical(node.path(it))) }
        }
        node.isArray -> mapper.createArrayNode().also { array -> node.forEach { array.add(canonical(it)) } }
        else -> node
    }

    private fun validateElement(element: JsonNode) {
        val type = text(element.path("type"), 20)
        requireValid(type in TYPES)
        val fields = BASE_FIELDS + when (type) {
            "freedraw" -> setOf("points", "pressures", "simulatePressure", "lastCommittedPoint")
            "line", "arrow" -> setOf("points", "lastCommittedPoint", "startBinding", "endBinding", "startArrowhead", "endArrowhead", "elbowed", "fixedSegments", "startIsSpecial", "endIsSpecial")
            "text" -> setOf("fontSize", "fontFamily", "text", "textAlign", "verticalAlign", "containerId", "originalText", "autoResize", "lineHeight")
            "frame" -> setOf("name")
            else -> emptySet()
        }
        objectFields(element, fields)
        id(element.path("id"))
        integer(element.path("version"), 1, Int.MAX_VALUE.toLong())
        integer(element.path("versionNonce"), 0, 4_294_967_295L)
        requireValid(element.path("isDeleted").isBoolean)
        listOf("x", "y", "angle").forEach { number(element.path(it), -MAX_COORDINATE, MAX_COORDINATE) }
        listOf("width", "height").forEach { number(element.path(it), 0.0, MAX_COORDINATE) }
        listOf("strokeColor", "backgroundColor").forEach { field ->
            element.get(field)?.let { requireValid(COLOR.matches(text(it, 100))) }
        }
        optionalEnum(element, "fillStyle", setOf("hachure", "cross-hatch", "solid", "zigzag"))
        optionalEnum(element, "strokeStyle", setOf("solid", "dashed", "dotted"))
        element.get("strokeWidth")?.let { number(it, 0.0, 1_000.0) }
        element.get("roughness")?.let { number(it, 0.0, 10.0) }
        element.get("opacity")?.let { number(it, 0.0, 100.0) }
        element.get("seed")?.let { integer(it, 0, 4_294_967_295L) }
        element.get("updated")?.let { integer(it, 0, MAX_SAFE_INTEGER) }
        element.get("locked")?.let { requireValid(it.isBoolean) }
        element.get("link")?.let { requireValid(it.isNull || (it.isTextual && it.asText().isEmpty())) }
        listOf("frameId", "containerId").forEach { field -> element.get(field)?.takeUnless { it.isNull }?.let(::id) }
        element.get("index")?.takeUnless { it.isNull }?.let(::fractionalIndex)
        element.get("groupIds")?.let { groups ->
            requireValid(groups.isArray && groups.size() <= 100)
            groups.forEach(::id)
        }
        element.get("boundElements")?.takeUnless { it.isNull }?.let { bound ->
            requireValid(bound.isArray && bound.size() <= MAX_ELEMENTS)
            bound.forEach { reference ->
                objectFields(reference, setOf("id", "type")); id(reference.path("id"))
                requireValid(reference.path("type").asText() in setOf("arrow", "text"))
            }
        }
        element.get("roundness")?.takeUnless { it.isNull }?.let { roundness ->
            objectFields(roundness, setOf("type", "value")); integer(roundness.path("type"), 1, 3)
            roundness.get("value")?.let { number(it, 0.0, 10_000.0) }
        }
        if (type in setOf("freedraw", "line", "arrow")) {
            val points = element.path("points")
            requireValid(points.isArray && points.size() in 1..MAX_STROKE_POINTS)
            points.forEach(::point)
            element.get("lastCommittedPoint")?.takeUnless { it.isNull }?.let(::point)
        }
        if (type == "freedraw") {
            val pressures = element.path("pressures")
            val simulated = element.path("simulatePressure")
            requireValid(simulated.isBoolean && pressures.isArray)
            requireValid(pressures.size() == element.path("points").size() || (simulated.asBoolean() && pressures.isEmpty))
            pressures.forEach { number(it, 0.0, 1.0) }
        }
        if (type == "line" || type == "arrow") {
            listOf("startBinding", "endBinding").forEach { field -> element.get(field)?.takeUnless { it.isNull }?.let { binding ->
                objectFields(binding, setOf("elementId", "focus", "gap", "fixedPoint"))
                id(binding.path("elementId")); number(binding.path("focus"), -1.0, 1.0); number(binding.path("gap"), 0.0, MAX_COORDINATE)
                binding.get("fixedPoint")?.let(::point)
            } }
            listOf("startArrowhead", "endArrowhead").forEach { field -> element.get(field)?.takeUnless { it.isNull }?.let {
                requireValid(it.isTextual && it.asText() in ARROWHEADS)
            } }
            element.get("elbowed")?.let { requireValid(it.isBoolean) }
            listOf("startIsSpecial", "endIsSpecial").forEach { field -> element.get(field)?.let { requireValid(it.isNull || it.isBoolean) } }
            element.get("fixedSegments")?.takeUnless { it.isNull }?.let { segments ->
                requireValid(segments.isArray && segments.size() <= MAX_STROKE_POINTS)
                segments.forEach { segment ->
                    objectFields(segment, setOf("start", "end", "index"))
                    point(segment.path("start")); point(segment.path("end")); integer(segment.path("index"), 0, MAX_STROKE_POINTS.toLong())
                }
            }
        }
        if (type == "text") {
            text(element.path("text"), 120_000, allowEmpty = true)
            text(element.path("originalText"), 120_000, allowEmpty = true)
            number(element.path("fontSize"), 0.1, 10_000.0)
            requireValid(integer(element.path("fontFamily"), 1, 8) in BROWSER_FONT_FAMILIES)
            optionalEnum(element, "textAlign", setOf("left", "center", "right"))
            optionalEnum(element, "verticalAlign", setOf("top", "middle", "bottom"))
            element.get("lineHeight")?.let { number(it, 0.1, 100.0) }
            element.get("autoResize")?.let { requireValid(it.isBoolean) }
        }
        if (type == "frame") element.get("name")?.takeUnless { it.isNull }?.let { text(it, 1_000, allowEmpty = true) }
    }

    private fun point(point: JsonNode) {
        requireValid(point.isArray && point.size() == 2)
        point.forEach { number(it, -MAX_COORDINATE, MAX_COORDINATE) }
    }
    private fun pointCount(elements: List<JsonNode>) = elements.sumOf { it.path("points").size().toLong() + it.path("fixedSegments").size().toLong() * 2 }
    private fun optionalEnum(node: JsonNode, field: String, values: Set<String>) = node.get(field)?.let { requireValid(it.isTextual && it.asText() in values) }
    private fun objectFields(node: JsonNode, allowed: Set<String>) {
        requireValid(node.isObject && node.fieldNames().asSequence().all { it in allowed })
    }
    private fun text(node: JsonNode, max: Int, allowEmpty: Boolean = false): String {
        requireValid(node.isTextual)
        val value = node.asText()
        requireValid(value.length <= max && (allowEmpty || value.isNotBlank()) && value.none { it.code < 32 && it !in "\n\r\t" })
        return value
    }
    private fun id(node: JsonNode): String = text(node, 128).also { requireValid(ID.matches(it) && it !in setOf("__proto__", "constructor", "prototype")) }
    private fun uuid(node: JsonNode): String = text(node, 36).also { requireValid(UUID.matches(it)) }
    private fun integer(node: JsonNode, min: Long, max: Long): Long {
        requireValid(node.isIntegralNumber && node.canConvertToLong())
        return node.asLong().also { requireValid(it in min..max) }
    }
    private fun number(node: JsonNode, min: Double, max: Double): Double {
        requireValid(node.isNumber)
        return node.asDouble().also { requireValid(it.isFinite() && it in min..max) }
    }
    private fun fractionalIndex(node: JsonNode) {
        val value = text(node, 128)
        requireValid(INDEX.matches(value))
        val first = value.first()
        val integerLength = when (first) {
            in 'a'..'z' -> first - 'a' + 2
            in 'A'..'Z' -> 'Z' - first + 2
            else -> 129
        }
        requireValid(value.length >= integerLength && (value.length == integerLength || value.last() != '0'))
        requireValid(value.take(integerLength) != "A" + "0".repeat(26))
    }
    private fun requireValid(value: Boolean) {
        if (!value) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректное содержимое доски или превышен её размер", code = "WHITEBOARD_INVALID_DOCUMENT")
    }

    private companion object {
        const val MAX_OPERATION_BYTES = 512_000
        const val MAX_SCENE_BYTES = 2_000_000
        const val MAX_ELEMENTS = 5_000
        const val MAX_STROKE_POINTS = 20_000
        const val MAX_TOTAL_POINTS = 100_000L
        const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
        const val MAX_COORDINATE = 10_000_000.0
        val TYPES = setOf("freedraw", "text", "line", "arrow", "rectangle", "diamond", "ellipse", "frame")
        // Pinned Excalidraw browser assets only: 4 is retired, 9 is server-side.
        val BROWSER_FONT_FAMILIES = setOf(1L, 2L, 3L, 5L, 6L, 7L, 8L)
        val BASE_FIELDS = setOf("id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roundness", "roughness", "opacity", "seed", "version", "versionNonce", "index", "isDeleted", "groupIds", "frameId", "boundElements", "updated", "link", "locked")
        val ARROWHEADS = setOf("arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline", "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many")
        val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        val ID = Regex("[A-Za-z0-9_-]{1,128}")
        val INDEX = Regex("[A-Za-z0-9]+")
        val COLOR = Regex("(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|(?:rgb|hsl)a?\\([0-9.,% +/\\-]+\\))")
    }
}
