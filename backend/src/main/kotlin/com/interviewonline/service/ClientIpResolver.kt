package com.interviewonline.service

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.net.InetAddress
import java.nio.charset.StandardCharsets

@Component
class ClientIpResolver(
    @Value("\${app.http.trusted-proxy-cidrs:}") trustedProxyCidrs: String,
) {
    private val trustedNetworks = trustedProxyCidrs.split(',').mapNotNull { Cidr.parse(it.trim()) }

    fun resolve(remoteAddress: String, forwarded: String?, xForwardedFor: String?): String {
        return resolve(remoteAddress, listOfNotNull(forwarded), listOfNotNull(xForwardedFor))
    }

    fun resolve(remoteAddress: String, forwarded: List<String>, xForwardedFor: List<String>): String {
        val remote = parseAddress(remoteAddress) ?: return UNKNOWN
        if (!isTrusted(remote)) return canonical(remote)
        val forwardedAggregate = aggregate(forwarded)
        if (!forwardedAggregate.valid) return canonical(remote)
        val chain = when {
            !forwardedAggregate.value.isNullOrBlank() -> parseForwarded(forwardedAggregate.value)
            else -> {
                val xForwardedForAggregate = aggregate(xForwardedFor)
                if (!xForwardedForAggregate.valid) return canonical(remote)
                if (xForwardedForAggregate.value.isNullOrBlank()) emptyList()
                else parseXForwardedFor(xForwardedForAggregate.value)
            }
        } ?: return canonical(remote)
        if (chain.isEmpty()) return canonical(remote)

        var currentHop = remote
        chain.asReversed().forEach { candidate ->
            if (!isTrusted(currentHop)) return canonical(currentHop)
            currentHop = candidate
        }
        return canonical(currentHop)
    }

    private fun aggregate(fields: List<String>): HeaderAggregate {
        if (fields.isEmpty()) return HeaderAggregate(null, true)
        val aggregate = StringBuilder()
        var byteCount = 0
        fields.forEachIndexed { index, field ->
            if (index > 0) byteCount += 1
            byteCount += field.toByteArray(StandardCharsets.UTF_8).size
            if (byteCount > MAX_HEADER_LENGTH) return HeaderAggregate(null, false)
            if (index > 0) aggregate.append(',')
            aggregate.append(field)
        }
        return HeaderAggregate(aggregate.toString(), true)
    }

    private fun parseForwarded(raw: String): List<InetAddress>? {
        if (raw.length > MAX_HEADER_LENGTH) return null
        val elements = raw.split(',')
        if (elements.size !in 1..MAX_HOPS) return null
        return elements.map { element ->
            val rawFor = element.split(';')
                .map { it.trim() }
                .firstOrNull { it.substringBefore('=').equals("for", ignoreCase = true) }
                ?.substringAfter('=', "")
                ?.trim()
                ?: return null
            parseNode(unquote(rawFor)) ?: return null
        }
    }

    private fun parseXForwardedFor(raw: String): List<InetAddress>? {
        if (raw.length > MAX_HEADER_LENGTH) return null
        val elements = raw.split(',')
        if (elements.size !in 1..MAX_HOPS) return null
        return elements.map { parseNode(it.trim()) ?: return null }
    }

    private fun parseNode(raw: String): InetAddress? {
        if (raw.startsWith('[')) {
            val closing = raw.indexOf(']')
            if (closing <= 1) return null
            val address = raw.substring(1, closing)
            if (!address.contains(':')) return null
            val suffix = raw.substring(closing + 1)
            if (suffix.isNotEmpty() && (!suffix.startsWith(':') || !validPort(suffix.substring(1)))) return null
            return parseAddress(address)
        }
        if (raw.count { it == ':' } == 1) {
            val address = raw.substringBeforeLast(':')
            val port = raw.substringAfterLast(':')
            if (!validPort(port)) return null
            return parseAddress(address)
        }
        return parseAddress(raw)
    }

    private fun validPort(raw: String): Boolean =
        raw.isNotEmpty() && raw.length <= 5 && raw.all(Char::isDigit) && raw.toInt() in 0..65_535

    private fun unquote(raw: String): String =
        if (raw.length >= 2 && raw.first() == '"' && raw.last() == '"') raw.substring(1, raw.lastIndex) else raw

    private fun isTrusted(address: InetAddress): Boolean = trustedNetworks.any { it.contains(address) }

    private fun canonical(address: InetAddress): String {
        val bytes = address.address
        if (bytes.size == 16 && bytes.take(10).all { it == 0.toByte() } &&
            bytes[10] == 0xff.toByte() && bytes[11] == 0xff.toByte()
        ) {
            return InetAddress.getByAddress(bytes.copyOfRange(12, 16)).hostAddress
        }
        return address.hostAddress.substringBefore('%')
    }

    private data class Cidr(val network: ByteArray, val prefixLength: Int) {
        fun contains(address: InetAddress): Boolean {
            val candidate = address.address
            if (candidate.size != network.size) return false
            val wholeBytes = prefixLength / 8
            val partialBits = prefixLength % 8
            for (index in 0 until wholeBytes) if (candidate[index] != network[index]) return false
            if (partialBits == 0) return true
            val mask = (0xff shl (8 - partialBits)) and 0xff
            return (candidate[wholeBytes].toInt() and mask) == (network[wholeBytes].toInt() and mask)
        }

        companion object {
            fun parse(raw: String): Cidr? {
                if (raw.isBlank()) return null
                val parts = raw.split('/', limit = 2)
                val address = parseAddress(parts[0]) ?: return null
                val bitCount = address.address.size * 8
                val prefix = parts.getOrNull(1)?.toIntOrNull() ?: bitCount
                if (prefix !in 0..bitCount) return null
                return Cidr(address.address, prefix)
            }
        }
    }

    companion object {
        private const val MAX_HOPS = 16
        private const val MAX_HEADER_LENGTH = 1_024
        private const val UNKNOWN = "unknown"

        private fun parseAddress(raw: String): InetAddress? {
            val value = raw.trim()
            val ipv4 = value.matches(Regex("^(?:0|[1-9]\\d{0,2})(?:\\.(?:0|[1-9]\\d{0,2})){3}$")) &&
                value.split('.').all { it.toInt() in 0..255 }
            val ipv6 = value.contains(':') && value.matches(Regex("^[0-9A-Fa-f:.]+$"))
            if (!ipv4 && !ipv6) return null
            return runCatching { InetAddress.getByName(value) }.getOrNull()
        }
    }

    private data class HeaderAggregate(val value: String?, val valid: Boolean)
}
