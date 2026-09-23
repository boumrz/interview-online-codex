package com.interviewonline.service

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ClientIpResolverTest {
    @Test
    fun `forwarding metadata is ignored unless the socket peer is explicitly trusted`() {
        assertEquals("127.0.0.1", resolve("", "127.0.0.1", "for=198.51.100.40", "198.51.100.41"))
        assertEquals("203.0.113.8", resolve("10.10.0.0/16", "203.0.113.8", "for=198.51.100.40", "198.51.100.41"))
    }

    @Test
    fun `RFC Forwarded is preferred and XFF is its fallback`() {
        assertEquals(
            "198.51.100.40",
            resolve("10.10.0.0/16", "10.10.2.7", "for=198.51.100.40", "198.51.100.41"),
        )
        assertEquals("198.51.100.41", resolve("10.10.0.0/16", "10.10.2.7", null, "198.51.100.41"))
    }

    @Test
    fun `trusted hops are stripped right to left and an untrusted intermediary stops the chain`() {
        assertEquals(
            "198.51.100.40",
            resolve("10.10.0.0/16", "10.10.2.7", null, "198.51.100.40, 10.10.2.6"),
        )
        assertEquals(
            "203.0.113.9",
            resolve("10.10.0.0/16", "10.10.2.7", null, "198.51.100.40, 203.0.113.9"),
        )
    }

    @Test
    fun `oversized overlong and malformed chains fail closed to the socket peer`() {
        val seventeenHops = (1..17).joinToString(",") { "10.10.0.$it" }
        assertEquals("10.10.2.7", resolve("10.10.0.0/16", "10.10.2.7", null, seventeenHops))
        assertEquals("10.10.2.7", resolve("10.10.0.0/16", "10.10.2.7", " ".repeat(1_025), null))
        assertEquals("10.10.2.7", resolve("10.10.0.0/16", "10.10.2.7", "for=unknown", null))
    }

    @Test
    fun `IPv4 IPv6 and IPv4-mapped addresses share canonical identities`() {
        assertEquals("198.51.100.40", resolve("10.10.0.0/16", "10.10.2.7", "for=::ffff:198.51.100.40", null))
        assertEquals(
            "2001:db8:0:0:0:0:0:40",
            resolve("2001:db8:1::/48", "2001:db8:1::7", "for=\"[2001:db8::40]:4711\"", null),
        )
    }

    @Test
    fun `malformed empty or nonnumeric forwarded ports fail closed to the socket peer`() {
        assertEquals(
            "10.10.2.7",
            resolve("10.10.0.0/16", "10.10.2.7", "for=\"[2001:db8::40]:garbage\"", null),
        )
        assertEquals(
            "10.10.2.7",
            resolve("10.10.0.0/16", "10.10.2.7", "for=198.51.100.40:", null),
        )
        assertEquals(
            "198.51.100.40",
            resolve("10.10.0.0/16", "10.10.2.7", "for=198.51.100.40:443", null),
        )
    }

    private fun resolve(
        trustedCidrs: String,
        remoteAddress: String,
        forwarded: String?,
        xForwardedFor: String?,
    ): String {
        val resolverClass = Class.forName("com.interviewonline.service.ClientIpResolver")
        val resolver = resolverClass.getConstructor(String::class.java).newInstance(trustedCidrs)
        return resolverClass.getMethod("resolve", String::class.java, String::class.java, String::class.java)
            .invoke(resolver, remoteAddress, forwarded, xForwardedFor) as String
    }
}
