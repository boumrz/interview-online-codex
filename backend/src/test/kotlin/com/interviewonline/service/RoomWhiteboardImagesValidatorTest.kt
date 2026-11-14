package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.UUID
import javax.imageio.ImageIO

class RoomWhiteboardImagesValidatorTest {
    private val mapper = ObjectMapper()
    private val validator = RoomWhiteboardValidator(mapper)
    private val png = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()
    private fun image() = mapOf("id" to "image", "type" to "image", "version" to 1, "versionNonce" to 1, "x" to 0, "y" to 0, "width" to 100, "height" to 100, "angle" to 0, "isDeleted" to false, "fileId" to "asset", "status" to "saved", "scale" to listOf(1, -1), "crop" to null)
    private fun file(bytes: ByteArray = png, mime: String = "image/png") = mapOf("id" to "asset", "mimeType" to mime, "dataURL" to "data:$mime;base64,${Base64.getEncoder().encodeToString(bytes)}", "created" to 1)
    private fun request(files: Map<String, Any?> = mapOf("asset" to file()), element: Map<String, Any?> = image()) = mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(mapOf("boardId" to UUID.randomUUID().toString(), "operationId" to UUID.randomUUID().toString(), "baseSequence" to 0, "elements" to listOf(element), "files" to files))
    private fun rejected(files: Map<String, Any?> = mapOf("asset" to file()), element: Map<String, Any?> = image()) {
        val error = assertThrows(ApiException::class.java) { validator.readRequest(request(files, element)) }
        assertEquals("WHITEBOARD_INVALID_DOCUMENT", error.code)
    }

    @Test fun `raster formats and image transforms use native validated schema`() {
        val jpeg = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 3, BufferedImage.TYPE_INT_RGB), "jpeg", it) }.toByteArray()
        val webp = Base64.getDecoder().decode("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=")
        listOf(file(), file(jpeg, "image/jpeg"), file(webp, "image/webp")).forEach { candidate ->
            assertDoesNotThrow { validator.readRequest(request(mapOf("asset" to candidate))) }
        }
        val crop = mapOf("x" to 0, "y" to 0, "width" to 1, "height" to 1, "naturalWidth" to 1, "naturalHeight" to 1)
        assertDoesNotThrow { validator.readRequest(request(element = image() + mapOf("crop" to crop))) }
    }

    @Test fun `binary limit permits exactly five MiB and rejects the next byte`() {
        assertDoesNotThrow { validator.readRequest(request(mapOf("asset" to file(png.copyOf(5 * 1024 * 1024))))) }
        rejected(mapOf("asset" to file(png.copyOf(5 * 1024 * 1024 + 1))))
    }

    @Test fun `external URLs svg MIME mismatches malformed base64 unsafe keys and dimensions are rejected`() {
        listOf(
            file() + mapOf("dataURL" to "https://outside.invalid/image.png"),
            file() + mapOf("dataURL" to "data:image/png;base64,%%%%"),
            file() + mapOf("dataURL" to "data:image/png;base64,${Base64.getEncoder().encodeToString(png).dropLast(1)}"),
            file(png, "image/jpeg"), file("<svg/>".toByteArray(), "image/svg+xml"), file("not an image".toByteArray()),
            file() + mapOf("id" to "other"), file() + mapOf("created" to -1), file() + mapOf("token" to "private"),
        ).forEach { rejected(mapOf("asset" to it)) }
        rejected(mapOf("__proto__" to file()))
        val giant = png.copyOf().also { it[16] = 0x7f; it[17] = 0x7f; it[18] = 0x7f; it[19] = 0x7f }
        rejected(mapOf("asset" to file(giant)))
        listOf(
            image() + mapOf("scale" to listOf(0, 1)), image() + mapOf("status" to "unknown"), image() + mapOf("fileId" to null),
            image() + mapOf("crop" to mapOf("x" to -1, "y" to 0, "width" to 1, "height" to 1, "naturalWidth" to 1, "naturalHeight" to 1)),
            image() + mapOf("crop" to mapOf("x" to 1, "y" to 0, "width" to 1, "height" to 1, "naturalWidth" to 1, "naturalHeight" to 1)),
        ).forEach { rejected(element = it) }
    }

    @Test fun `board decoded file budget permits twenty MiB and rejects one more file`() {
        val large = mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(file(png.copyOf(5 * 1024 * 1024)))
        val files = (0..3).associate { "asset-$it" to large }
        val elements = (0..3).map { mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(image() + mapOf("id" to "image-$it", "fileId" to "asset-$it")) }
        assertDoesNotThrow { validator.validateScene(elements, files) }
        assertThrows(ApiException::class.java) { validator.validateScene(elements, files + ("extra" to mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(file()))) }
    }

    @Test fun `images do not relax the existing half megabyte element operation budget`() {
        val base = image().filterKeys { it !in setOf("fileId", "status", "scale", "crop") }
        val texts = (1..3).map { base + mapOf("id" to "text-$it", "type" to "text", "text" to "a".repeat(100_000), "originalText" to "a".repeat(100_000), "fontSize" to 24, "fontFamily" to 5) }
        val largeElements = request(emptyMap()).deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().also { it.set<com.fasterxml.jackson.databind.JsonNode>("elements", mapper.valueToTree(texts)) }
        assertThrows(ApiException::class.java) { validator.readRequest(largeElements) }
        rejected((1..101).associate { "file-$it" to (file() + mapOf("id" to "file-$it")) })
        val threeMiB = file(png.copyOf(3 * 1024 * 1024))
        rejected(mapOf("asset" to threeMiB, "second" to (threeMiB + mapOf("id" to "second"))))
    }
}
