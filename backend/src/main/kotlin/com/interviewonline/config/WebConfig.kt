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
        val origins = allowedOrigins
            .split(",")
            .map(String::trim)
            .filter(String::isNotBlank)
            .distinct()
            .toTypedArray()

        registry.addMapping("/api/**")
            .allowedOrigins(*origins)
            .allowCredentials(true)
            .allowedMethods("*")
            .allowedHeaders("*")
            .exposedHeaders("Content-Disposition", "Interview-Count")
    }
}
