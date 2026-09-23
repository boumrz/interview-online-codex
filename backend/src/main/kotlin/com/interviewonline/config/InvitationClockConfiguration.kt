package com.interviewonline.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Clock

@Configuration(proxyBeanMethods = false)
class InvitationClockConfiguration {
    @Bean
    fun systemClock(): Clock = Clock.systemUTC()
}
