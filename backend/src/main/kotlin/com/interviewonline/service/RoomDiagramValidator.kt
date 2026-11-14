package com.interviewonline.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.RoomDiagramChangeRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.xml.sax.InputSource
import org.xml.sax.SAXParseException
import org.xml.sax.helpers.DefaultHandler
import java.io.ByteArrayOutputStream
import java.io.StringReader
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID
import java.util.zip.Inflater
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory

/** Validates both inputs that the native editor will parse: baseline and patch. */
@Component
class RoomDiagramValidator(private val mapper: ObjectMapper) {
    private class Budget {
        var inflatedBytes = 0
        val validatedStencils = mutableMapOf<String, Int>()
    }

    fun validate(request: RoomDiagramChangeRequest): Element? {
        if (runCatching { UUID.fromString(request.operationId) }.isFailure || request.operationId.length != 36 ||
            runCatching { UUID.fromString(request.diagramId) }.isFailure || request.diagramId.length != 36 ||
            request.baseSequence < 0 || request.xml.isBlank() || bytes(request.xml) > MAX_XML_BYTES ||
            (request.checksum?.length ?: 0) > 128
        ) reject("Некорректное изменение схемы или превышен размер документа")
        val budget = Budget()
        val document = parseXml(request.xml, maxElements = 50_000, maxDepth = 64)
        if (document.documentElement.tagName != "mxfile") reject("Нужен несжатый документ draw.io")
        val pages = elements(document.documentElement)
        if (pages.size != 1 || pages[0].tagName != "diagram" || pages[0].getAttribute("id") != PAGE_ID) {
            reject("Поддерживается одна общая страница схемы")
        }
        val page = pages[0]
        val models = elements(page)
        if (models.size != 1 || models[0].tagName != "mxGraphModel" || hasText(page)) reject("Нужна несжатая страница схемы")
        if (document.getElementsByTagName("mxCell").length > 5_000) reject("Превышен лимит элементов схемы")
        validateCellIds(models[0])
        validateStyles(document, budget)
        request.patch?.let { validatePatch(it, budget) }
        return cellRoot(document)
    }

    /** Compare only graph content. Native zoom, pan, editor attributes and XML layout are local details. */
    fun cellsChanged(previousXml: String, proposed: Element?): Boolean {
        val previous = cellRoot(parseXml(previousXml, maxElements = 50_000, maxDepth = 64))
        return if (previous == null) proposed != null else !previous.isEqualNode(proposed)
    }

    private fun cellRoot(document: Document): Element? {
        val model = document.getElementsByTagName("mxGraphModel").item(0) as? Element ?: return null
        val root = elements(model).firstOrNull { it.tagName == "root" } ?: return null
        fun removeIndentation(node: Node) {
            val elementContent = node is Element && (node.tagName in GRAPH_CONTAINERS || elements(node).isNotEmpty())
            var child = node.firstChild
            while (child != null) {
                val next = child.nextSibling
                if (child.nodeType == Node.COMMENT_NODE ||
                    (elementContent && child.nodeType == Node.TEXT_NODE && child.nodeValue.isBlank())
                ) node.removeChild(child) else removeIndentation(child)
                child = next
            }
        }
        removeIndentation(root)
        return root
    }

    private fun validateCellIds(model: Element) {
        val ids = mutableSetOf<String>()
        // mxGraphModel decodes each direct entry of <root> as one cell.
        // For UserObject/object entries, the outer id is the logical cell id;
        // their nested mxCell normally has no id and must not be counted twice.
        elements(model).filter { it.tagName == "root" }.forEach { root ->
            elements(root).forEach { entry ->
                val id = entry.getAttribute("id")
                identifier(id)
                if (!ids.add(id)) reject("Повторяющийся идентификатор элемента схемы")
                if (entry.tagName != "mxCell") {
                    elements(entry).filter { it.tagName == "mxCell" && it.hasAttribute("id") }.forEach { inner ->
                        val innerId = inner.getAttribute("id")
                        identifier(innerId)
                        if (innerId != id) reject("Неоднозначный идентификатор элемента схемы")
                    }
                }
            }
        }
    }

    private fun validatePatch(patch: JsonNode, budget: Budget) {
        if (!patch.isObject) reject("Некорректное изменение схемы")
        jsonBudget(patch)
        if (mapper.writeValueAsBytes(patch).size > MAX_PATCH_BYTES) reject("Некорректное изменение схемы")
        keys(patch, setOf("u"))
        patch.get("u")?.let { pages ->
            if (!pages.isObject || pages.size() > 1) reject("Некорректные страницы изменения")
            pages.fields().forEachRemaining { (id, page) ->
                if (id != PAGE_ID || !page.isObject) reject("Неизвестная страница изменения")
                keys(page, setOf("cells", "view", "name", "previous", "viewBox", "group", "alt"))
                page.fields().forEachRemaining { (name, value) ->
                    when (name) {
                        "cells" -> validateCells(value, budget)
                        "view" -> validateView(value)
                        else -> if (!value.isTextual || value.asText().length > 4_096) reject("Некорректное свойство страницы")
                    }
                }
            }
        }
    }

    private fun validateCells(cells: JsonNode, budget: Budget) {
        if (!cells.isObject) reject("Некорректное изменение элементов")
        keys(cells, setOf("u", "i", "r"))
        cells.get("u")?.let { updates ->
            if (!updates.isObject || updates.size() > 5_000) reject("Некорректные изменения элементов")
            updates.fields().forEachRemaining { (id, update) ->
                identifier(id)
                validateCell(update, false, budget)
            }
        }
        cells.get("i")?.let { inserts ->
            if (!inserts.isArray || inserts.size() > 5_000) reject("Некорректные новые элементы")
            val ids = mutableSetOf<String>()
            inserts.forEach { cell ->
                validateCell(cell, true, budget)
                if (!ids.add(cell.path("id").asText())) reject("Повторяющийся идентификатор элемента")
            }
        }
        cells.get("r")?.let { removals ->
            if (!removals.isArray || removals.size() > 5_000) reject("Некорректное удаление элементов")
            removals.forEach { if (!it.isTextual) reject("Некорректный идентификатор элемента") else identifier(it.asText()) }
        }
    }

    private fun validateCell(cell: JsonNode, inserted: Boolean, budget: Budget) {
        if (!cell.isObject) reject("Некорректный элемент схемы")
        keys(cell, CELL_FIELDS)
        if (inserted) {
            if (!cell.path("id").isTextual || !cell.path("parent").isTextual) reject("Новый элемент должен иметь id и parent")
            identifier(cell.path("id").asText())
            identifier(cell.path("parent").asText())
        }
        cell.fields().forEachRemaining { (name, value) ->
            when (name) {
                "id", "parent", "source", "target", "previous" -> {
                    if (!value.isTextual || value.asText().length > 255) reject("Некорректная связь элемента")
                    if (value.asText().isNotEmpty()) identifier(value.asText())
                }
                "vertex", "edge", "connectable", "collapsed", "visible" ->
                    if (!value.isIntegralNumber || value.asInt() !in 0..1) reject("Некорректный флаг элемента")
                "style" -> if (!value.isNull) {
                    if (!value.isTextual) reject("Некорректный стиль элемента")
                    validateStyle(value.asText(), budget)
                }
                "geometry" -> {
                    if (!value.isTextual || bytes(value.asText()) > 65_536) reject("Некорректная геометрия элемента")
                    val geometry = parseXml(value.asText(), 2_000, 16)
                    if (geometry.documentElement.tagName != "mxGeometry") reject("Некорректная геометрия элемента")
                }
                "xmlValue" -> {
                    if (!value.isTextual || bytes(value.asText()) > 65_536) reject("Некорректные данные элемента")
                    val xml = parseXml(value.asText(), 500, 16)
                    if (xml.documentElement.tagName !in setOf("object", "UserObject")) reject("Некорректные данные элемента")
                    validateStyles(xml, budget)
                }
                "value" -> if (!value.isNull && !value.isTextual && !value.isNumber && !value.isBoolean) reject("Некорректная подпись элемента")
            }
        }
    }

    private fun validateView(view: JsonNode) {
        if (!view.isObject || view.size() > 64) reject("Некорректный вид страницы")
        view.fields().forEachRemaining { (key, value) ->
            identifier(key)
            if (!value.isNull && (!value.isTextual || value.asText().length > 16_384)) reject("Некорректное свойство вида")
            if (value.isTextual) {
                val parsed = runCatching { mapper.readTree(value.asText()) }.getOrNull()
                    ?: reject("Некорректное свойство вида")
                jsonBudget(parsed)
            }
        }
    }

    private fun validateStyles(document: Document, budget: Budget) {
        val all = document.getElementsByTagName("*")
        for (index in 0 until all.length) {
            val element = all.item(index) as Element
            if (element.hasAttribute("style")) validateStyle(element.getAttribute("style"), budget)
        }
    }

    private fun validateStyle(style: String, budget: Budget) {
        for (entry in style.split(';')) {
            val separator = entry.indexOf('=')
            if (separator < 0 || entry.substring(0, separator) != "shape") continue
            val shape = entry.substring(separator + 1)
            if (!shape.startsWith("stencil(")) continue
            if (!shape.endsWith(')')) reject("Некорректный рисунок схемы")
            val encoded = shape.substring(8, shape.length - 1)
            val cost = budget.validatedStencils[encoded] ?: validateStencil(encoded).also { budget.validatedStencils[encoded] = it }
            budget.inflatedBytes += cost
            if (budget.inflatedBytes > MAX_STENCILS_TOTAL_BYTES) reject("Превышен лимит свободных рисунков схемы")
        }
    }

    private fun validateStencil(encoded: String): Int {
        if (encoded.length > MAX_PATCH_BYTES) reject("Превышен размер рисунка схемы")
        try {
            val compressed = Base64.getDecoder().decode(encoded)
            val inflater = Inflater(true)
            val output = ByteArrayOutputStream()
            try {
                inflater.setInput(compressed)
                val buffer = ByteArray(4_096)
                while (!inflater.finished()) {
                    val count = inflater.inflate(buffer)
                    if (count == 0) reject("Некорректно сжатый рисунок схемы")
                    if (output.size() + count > MAX_STENCIL_INFLATED_BYTES) reject("Превышен размер рисунка схемы")
                    output.write(buffer, 0, count)
                }
                if (inflater.remaining != 0) reject("Некорректно сжатый рисунок схемы")
            } finally { inflater.end() }
            // Graph.compress = base64(deflateRaw(encodeURIComponent(xml))).
            // Preserve literal '+' because decodeURIComponent does not treat it as a space.
            val xml = URLDecoder.decode(output.toString(StandardCharsets.UTF_8).replace("+", "%2B"), StandardCharsets.UTF_8)
            val document = parseXml(xml, 2_000, 32)
            if (document.documentElement.tagName != "shape") reject("Неизвестный формат рисунка схемы")
            val commands = document.getElementsByTagName("*")
            for (index in 0 until commands.length) {
                if (commands.item(index).nodeName !in STENCIL_COMMANDS) reject("Неподдерживаемая команда рисунка схемы")
            }
            return output.size()
        } catch (exception: ApiException) { throw exception
        } catch (_: Exception) { reject("Некорректный рисунок схемы") }
    }

    private fun parseXml(xml: String, maxElements: Int, maxDepth: Int): Document {
        try {
            val factory = DocumentBuilderFactory.newInstance()
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false)
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "")
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "")
            factory.setAttribute("http://www.oracle.com/xml/jaxp/properties/maxElementDepth", maxDepth)
            factory.isXIncludeAware = false
            factory.isExpandEntityReferences = false
            val builder = factory.newDocumentBuilder()
            builder.setErrorHandler(object : DefaultHandler() {
                override fun error(exception: SAXParseException) { throw exception }
                override fun fatalError(exception: SAXParseException) { throw exception }
            })
            val document = builder.parse(InputSource(StringReader(xml)))
            if (document.getElementsByTagName("*").length > maxElements) reject("Превышен лимит элементов XML")
            return document
        } catch (exception: ApiException) { throw exception
        } catch (_: Exception) { reject("Некорректный XML схемы") }
    }

    private fun jsonBudget(root: JsonNode) {
        val pending = ArrayDeque<Pair<JsonNode, Int>>()
        pending.add(root to 0)
        var count = 0
        while (pending.isNotEmpty()) {
            val (node, depth) = pending.removeLast()
            if (++count > 25_000 || depth > 24) reject("Превышен лимит структуры изменения")
            if (node.isObject) node.fieldNames().forEachRemaining(::identifier)
            if (node.isContainerNode) node.forEach { pending.add(it to depth + 1) }
        }
    }

    private fun elements(element: Element): List<Element> = (0 until element.childNodes.length)
        .map { element.childNodes.item(it) }.filter { it.nodeType == Node.ELEMENT_NODE }.map { it as Element }
    private fun hasText(element: Element): Boolean = (0 until element.childNodes.length)
        .map { element.childNodes.item(it) }.any { it.nodeType == Node.TEXT_NODE && !it.textContent.isNullOrBlank() }
    private fun keys(node: JsonNode, allowed: Set<String>) {
        node.fieldNames().forEachRemaining { if (it !in allowed) reject("Неизвестное свойство изменения") }
    }
    private fun identifier(value: String) {
        if (value.isBlank() || value.length > 255 || value in setOf("__proto__", "prototype", "constructor") || value.any { it.code < 32 }) {
            reject("Некорректный идентификатор изменения")
        }
    }
    private fun bytes(value: String) = value.toByteArray(StandardCharsets.UTF_8).size
    private fun reject(message: String): Nothing = throw ApiException(HttpStatus.BAD_REQUEST, message, code = "DIAGRAM_INVALID_DOCUMENT")

    private companion object {
        val GRAPH_CONTAINERS = setOf("root", "mxCell", "mxGeometry", "mxPoint", "mxRectangle", "Array")
        const val PAGE_ID = "room-diagram"
        const val MAX_XML_BYTES = 2_000_000
        const val MAX_PATCH_BYTES = 250_000
        const val MAX_STENCIL_INFLATED_BYTES = 262_144
        const val MAX_STENCILS_TOTAL_BYTES = 2_000_000
        val CELL_FIELDS = setOf("id", "parent", "source", "target", "previous", "vertex", "edge", "connectable", "collapsed", "visible", "style", "geometry", "xmlValue", "value")
        val STENCIL_COMMANDS = setOf("shape", "foreground", "background", "path", "move", "line", "quad", "curve", "arc", "close", "stroke", "fill", "fillstroke", "strokecolor", "fillcolor", "strokewidth", "linejoin", "linecap", "alpha", "dashpattern", "dashed", "save", "restore", "rect", "ellipse", "roundrect")
    }
}
