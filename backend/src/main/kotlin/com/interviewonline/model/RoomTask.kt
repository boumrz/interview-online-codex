package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table

@Entity
@Table(name = "room_tasks")
class RoomTask(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(optional = false)
    @JoinColumn(name = "room_id")
    var room: Room? = null,

    @Column(name = "step_index", nullable = false)
    var stepIndex: Int = 0,

    @Column(nullable = false)
    var title: String = "",

    @Column(nullable = false, columnDefinition = "TEXT")
    var description: String = "",

    @Column(name = "starter_code", nullable = false, columnDefinition = "TEXT")
    var starterCode: String = "",

    @Column(name = "solution_code", columnDefinition = "TEXT")
    var solutionCode: String? = null,

    @Column(name = "interviewer_notes", columnDefinition = "TEXT")
    var interviewerNotes: String? = null,

    @Column(name = "private_notes_json", columnDefinition = "TEXT")
    var privateNotesJson: String? = null,

    @Column(name = "briefing_markdown", columnDefinition = "TEXT")
    var briefingMarkdown: String? = null,

    @Column(name = "solution_language")
    var solutionLanguage: String? = null,

    /**
     * A full Yjs document for the manager-only preparation workspace. This is
     * deliberately stored on a task rather than on [Room], because a draft for
     * an inactive task must survive a process restart without becoming public.
     */
    @Column(name = "workspace_yjs_document_base64", columnDefinition = "TEXT")
    var workspaceYjsDocumentBase64: String? = null,

    @Column(name = "workspace_yjs_sequence", nullable = false)
    var workspaceYjsSequence: Long = 0,

    /** Optimistic revision for non-CRDT fields (briefing, language, focus mode). */
    @Column(name = "workspace_revision", nullable = false)
    var workspaceRevision: Long = 0,

    /**
     * Canonical focus-mode value for a prepared task. Null is the legacy state;
     * callers then fall back to the marker in briefingMarkdown.
     */
    @Column(name = "workspace_focus_mode")
    var workspaceFocusMode: Boolean? = null,

    @Column(name = "score")
    var score: Int? = null,

    @Column(name = "source_task_template_id")
    var sourceTaskTemplateId: String? = null,

    @Column(nullable = false)
    var language: String = "nodejs",

    @Column(name = "category_name")
    var categoryName: String? = null,
)
