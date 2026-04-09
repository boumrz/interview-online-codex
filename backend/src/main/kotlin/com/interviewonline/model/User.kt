package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "users")
class User(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @Column(unique = true, nullable = false)
    var nickname: String = "",

    @Column(name = "display_name")
    var displayName: String? = null,

    @Column(name = "password_hash", nullable = false)
    var passwordHash: String = "",

    @Column(name = "role", nullable = false, length = 32)
    var role: String = "user",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)
