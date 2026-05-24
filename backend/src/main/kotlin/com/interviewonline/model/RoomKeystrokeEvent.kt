package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table

@Entity
@Table(
    name = "room_keystroke_events",
    indexes = [
        Index(name = "idx_rke_room_ts", columnList = "room_id, timestamp_epoch_ms"),
    ]
)
class RoomKeystrokeEvent(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @Column(name = "room_id", nullable = false, length = 255)
    var roomId: String = "",

    @Column(name = "session_id", nullable = false, length = 128)
    var sessionId: String = "",

    @Column(name = "display_name", nullable = false, length = 128)
    var displayName: String = "",

    @Column(name = "key_value", length = 64)
    var keyValue: String? = null,

    @Column(name = "key_code", length = 64)
    var keyCode: String? = null,

    @Column(name = "ctrl_key", nullable = false)
    var ctrlKey: Boolean = false,

    @Column(name = "alt_key", nullable = false)
    var altKey: Boolean = false,

    @Column(name = "shift_key", nullable = false)
    var shiftKey: Boolean = false,

    @Column(name = "meta_key", nullable = false)
    var metaKey: Boolean = false,

    @Column(name = "event_kind", nullable = false, length = 32)
    var eventKind: String = "keydown",

    @Column(name = "paste_length")
    var pasteLength: Int? = null,

    @Column(name = "paste_preview", length = 50)
    var pastePreview: String? = null,

    @Column(name = "timestamp_epoch_ms", nullable = false)
    var timestampEpochMs: Long = 0L,
)
