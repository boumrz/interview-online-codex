package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "user_task_categories")
class UserTaskCategory(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_user_id")
    var ownerUser: User? = null,

    @Column(nullable = false)
    var name: String = "",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)
