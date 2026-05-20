package com.interviewonline.model

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "task_presets")
class TaskPreset(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_user_id", nullable = false)
    var ownerUser: User? = null,

    @Column(nullable = false)
    var name: String = "",

    @OneToMany(
        mappedBy = "preset",
        cascade = [CascadeType.ALL],
        orphanRemoval = true,
        fetch = FetchType.LAZY
    )
    @OrderBy("position ASC")
    var items: MutableList<PresetItem> = mutableListOf(),

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)
