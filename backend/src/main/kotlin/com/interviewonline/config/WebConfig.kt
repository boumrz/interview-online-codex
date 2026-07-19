package com.interviewonline.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class WebConfig(
    @Value("\${app.cors.allowed-origins}") private val allowedOrigins: String,
) : WebMvcConfigurer {
    override fun addCorsMappings(registry: CorsRegistry) {
        val origins = linkedSetOf(
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ).apply {
            allowedOrigins
                .split(",")
                .map(String::trim)
                .filter(String::isNotBlank)
                .forEach(::add)
        }.toTypedArray()

        registry.addMapping("/api/**")
            .allowedOrigins(*origins)
            .allowedMethods("*")
            .allowedHeaders("*")
    }
}
