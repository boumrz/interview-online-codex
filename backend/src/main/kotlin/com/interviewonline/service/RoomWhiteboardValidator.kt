package com.interviewonline.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.RoomWhiteboardChangeRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import java.io.ByteArrayInputStream
import java.util.Base64
import javax.imageio.ImageIO
import javax.imageio.stream.MemoryCacheImageInputStream

@Component
class RoomWhiteboardValidator(private val mapper: ObjectMapper) {
    fun readRequest(body: JsonNode): RoomWhiteboardChangeRequest {
        requireValid(mapper.writeValueAsBytes(body).size <= MAX_OPERATION_BYTES)
        objectFields(body, setOf("boardId", "operationId", "baseSequence", "elements", "files"))
        val boardId = uuid(body.path("boardId"))
        val operationId = uuid(body.path("operationId"))
        val base = integer(body.path("baseSequence"), 0, MAX_SAFE_INTEGER)
        val elements = body.path("elements")
        requireValid(elements.isArray && elements.size() in 1..MAX_ELEMENTS)
        requireValid(mapper.writeValueAsBytes(elements).size <= MAX_ELEMENT_OPERATION_BYTES)
        val changes = elements.toList()
        requireValid(changes.map { it.path("id").asText() }.distinct().size == changes.size)
        changes.forEach(::validateElement)
        requireValid(pointCount(changes) <= MAX_TOTAL_POINTS)
        val files = body.get("files")?.let { node ->
            requireValid(node.isObject && node.size() <= MAX_FILES)
            node.fields().asSequence().associate { (key, file) ->
                validateFile(key, file)
                key to file
            }
        } ?: emptyMap()
        return RoomWhiteboardChangeRequest(boardId, operationId, base, changes, files)
    }

    fun knownFileIds(value: String?): Set<String> {
        if (value.isNullOrEmpty()) return emptySet()
        requireValid(value.length <= MAX_FILES * 129 - 1)
        val ids = value.split(',')
        requireValid(ids.size <= MAX_FILES && ids.all { ID.matches(it) && it !in setOf("__proto__", "constructor", "prototype") })
        return ids.toSet()
    }

    fun validateScene(elements: List<JsonNode>, files: Map<String, JsonNode> = emptyMap()) {
        requireValid(elements.size <= MAX_ELEMENTS && pointCount(elements) <= MAX_TOTAL_POINTS)
        requireValid(mapper.writeValueAsBytes(elements).size <= MAX_SCENE_BYTES)
        requireValid(files.size <= MAX_FILES && files.values.sumOf(::decodedFileSize) <= MAX_BOARD_FILE_BYTES)
        elements.filter { it.path("type").asText() == "image" }.forEach { requireValid(files.containsKey(it.path("fileId").asText())) }
    }

    /** IDs are immutable content identities; SDK retrieval metadata may differ. */
    fun mergeFiles(current: Map<String, JsonNode>, incoming: Map<String, JsonNode>, elements: List<JsonNode>): Map<String, JsonNode> {
        val merged = current.toMutableMap()
        val referenced = elements.filter { it.path("type").asText() == "image" }.map { it.path("fileId").asText() }.toSet()
        incoming.forEach { (key, file) ->
            val previous = current[key]
            if (previous != null) requireValid(previous.path("dataURL") == file.path("dataURL") && previous.path("mimeType") == file.path("mimeType"))
            else {
                requireValid(key in referenced)
                merged[key] = file
            }
        }
        return merged
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
            "image" -> setOf("fileId", "status", "scale", "crop")
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
        if (type == "image") {
            id(element.path("fileId"))
            requireValid(element.path("status").asText() in setOf("pending", "saved", "error"))
            val scale = element.path("scale")
            requireValid(scale.isArray && scale.size() == 2)
            scale.forEach { requireValid(it.isNumber && it.asDouble() in setOf(-1.0, 1.0)) }
            element.get("crop")?.takeUnless { it.isNull }?.let { crop ->
                objectFields(crop, setOf("x", "y", "width", "height", "naturalWidth", "naturalHeight"))
                val naturalWidth = number(crop.path("naturalWidth"), 1.0, MAX_IMAGE_DIMENSION.toDouble())
                val naturalHeight = number(crop.path("naturalHeight"), 1.0, MAX_IMAGE_DIMENSION.toDouble())
                val x = number(crop.path("x"), 0.0, naturalWidth)
                val y = number(crop.path("y"), 0.0, naturalHeight)
                val width = number(crop.path("width"), 0.000001, naturalWidth)
                val height = number(crop.path("height"), 0.000001, naturalHeight)
                requireValid(x + width <= naturalWidth + 0.000001 && y + height <= naturalHeight + 0.000001)
            }
        }
        if (type == "frame") element.get("name")?.takeUnless { it.isNull }?.let { text(it, 1_000, allowEmpty = true) }
    }

    private fun validateFile(key: String, file: JsonNode) {
        requireValid(ID.matches(key) && key !in setOf("__proto__", "constructor", "prototype"))
        objectFields(file, setOf("id", "mimeType", "dataURL", "created", "lastRetrieved", "version"))
        requireValid(id(file.path("id")) == key)
        val mime = text(file.path("mimeType"), 20)
        requireValid(mime in setOf("image/png", "image/jpeg", "image/webp"))
        integer(file.path("created"), 0, MAX_SAFE_INTEGER)
        file.get("lastRetrieved")?.let { integer(it, 0, MAX_SAFE_INTEGER) }
        file.get("version")?.let { integer(it, 0, MAX_SAFE_INTEGER) }
        val data = text(file.path("dataURL"), (MAX_FILE_BYTES + 2) / 3 * 4 + 40)
        val prefix = "data:$mime;base64,"
        requireValid(data.startsWith(prefix))
        val encoded = data.substring(prefix.length)
        val bytes = try { Base64.getDecoder().decode(encoded) } catch (_: IllegalArgumentException) { requireValid(false); byteArrayOf() }
        requireValid(bytes.isNotEmpty() && bytes.size <= MAX_FILE_BYTES && Base64.getEncoder().encodeToString(bytes) == encoded)
        val (width, height) = if (mime == "image/webp") webpDimensions(bytes) else rasterDimensions(bytes, mime)
        requireValid(width in 1..MAX_IMAGE_DIMENSION && height in 1..MAX_IMAGE_DIMENSION && width.toLong() * height <= MAX_IMAGE_PIXELS)
    }

    private fun decodedFileSize(file: JsonNode): Long {
        val data = file.path("dataURL").asText()
        val padding = when { data.endsWith("==") -> 2; data.endsWith("=") -> 1; else -> 0 }
        return (data.length - data.indexOf(',') - 1).toLong() / 4 * 3 - padding
    }

    /** Read format headers only: never allocate an attacker-controlled pixel buffer. */
    private fun rasterDimensions(bytes: ByteArray, mime: String): Pair<Int, Int> {
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        requireValid(if (mime == "image/png") bytes.size >= 33 && bytes.take(8).toByteArray().contentEquals(png)
            else bytes.size >= 4 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte())
        val reader = ImageIO.getImageReadersByFormatName(if (mime == "image/png") "png" else "jpeg").next()
        try {
            MemoryCacheImageInputStream(ByteArrayInputStream(bytes)).use { stream ->
                reader.setInput(stream, true, true)
                return reader.getWidth(0) to reader.getHeight(0)
            }
        } catch (_: Exception) { requireValid(false); return 0 to 0 }
        finally { reader.dispose() }
    }

    private fun webpDimensions(bytes: ByteArray): Pair<Int, Int> {
        fun tag(offset: Int, value: String) = bytes.size >= offset + value.length && value.indices.all { bytes[offset + it].toInt() == value[it].code }
        fun unsigned(offset: Int) = bytes[offset].toInt() and 255
        fun little(offset: Int, length: Int): Long = (0 until length).sumOf { unsigned(offset + it).toLong() shl (it * 8) }
        requireValid(bytes.size >= 30 && tag(0, "RIFF") && tag(8, "WEBP") && little(4, 4) + 8 == bytes.size.toLong())
        val chunkSize = little(16, 4)
        requireValid(chunkSize > 0 && chunkSize + 20 <= bytes.size)
        return when {
            tag(12, "VP8 ") -> {
                requireValid(chunkSize >= 10 && unsigned(23) == 0x9d && unsigned(24) == 0x01 && unsigned(25) == 0x2a)
                (little(26, 2).toInt() and 0x3fff) to (little(28, 2).toInt() and 0x3fff)
            }
            tag(12, "VP8L") -> {
                requireValid(chunkSize >= 5 && unsigned(20) == 0x2f)
                val packed = little(21, 4)
                ((packed and 0x3fff) + 1).toInt() to (((packed shr 14) and 0x3fff) + 1).toInt()
            }
            tag(12, "VP8X") -> {
                requireValid(chunkSize == 10L && unsigned(20) and 2 == 0)
                (little(24, 3) + 1).toInt() to (little(27, 3) + 1).toInt()
            }
            else -> { requireValid(false); 0 to 0 }
        }
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
        const val MAX_OPERATION_BYTES = 8 * 1024 * 1024
        const val MAX_ELEMENT_OPERATION_BYTES = 512_000
        const val MAX_FILE_BYTES = 5 * 1024 * 1024
        const val MAX_BOARD_FILE_BYTES = 20L * 1024 * 1024
        const val MAX_FILES = 100
        const val MAX_IMAGE_DIMENSION = 16_384
        const val MAX_IMAGE_PIXELS = 40_000_000L
        const val MAX_SCENE_BYTES = 2_000_000
        const val MAX_ELEMENTS = 5_000
        const val MAX_STROKE_POINTS = 20_000
        const val MAX_TOTAL_POINTS = 100_000L
        const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
        const val MAX_COORDINATE = 10_000_000.0
        val TYPES = setOf("freedraw", "text", "line", "arrow", "rectangle", "diamond", "ellipse", "frame", "image")
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
