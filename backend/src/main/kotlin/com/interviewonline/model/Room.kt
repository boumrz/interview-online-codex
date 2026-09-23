package com.interviewonline.model

import jakarta.persistence.CascadeType
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.OneToMany
import jakarta.persistence.OrderBy
import jakarta.persistence.Table
import java.time.Instant
import org.hibernate.annotations.DynamicUpdate

@Entity
@Table(name = "rooms")
@DynamicUpdate
class Room(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @Column(nullable = false)
    var title: String = "Interview Room",

    @Column(name = "invite_code", unique = true, nullable = false)
    var inviteCode: String = "",

    @Column(name = "owner_session_token", nullable = false)
    var ownerSessionToken: String = "",

    @Column(name = "interviewer_session_token", nullable = false)
    var interviewerSessionToken: String = "",

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_user_id")
    var ownerUser: User? = null,

    @Column(name = "created_by_user_id")
    var createdByUserId: String? = null,

    @Column(name = "team_id")
    var teamId: String? = null,

    @Column(name = "origin_team_id")
    var originTeamId: String? = null,

    @Column(name = "team_interview_created", nullable = false)
    var teamInterviewCreated: Boolean = false,

    @Column(name = "team_track_id")
    var teamTrackId: String? = null,

    @Column(name = "team_vacancy_id")
    var teamVacancyId: String? = null,

    @Column(name = "team_task_set_id")
    var teamTaskSetId: String? = null,

    @Column(name = "team_task_set_revision")
    var teamTaskSetRevision: Long? = null,

    @Column(name = "team_interview_programme_id")
    var teamInterviewProgrammeId: String? = null,

    @Column(name = "team_interview_programme_origin", length = 32)
    var teamInterviewProgrammeOrigin: String? = null,

    @Column(name = "team_interview_programme_version")
    var teamInterviewProgrammeVersion: Long? = null,

    @Column(nullable = false)
    var language: String = "nodejs",

    @Column(name = "current_step", nullable = false)
    var currentStep: Int = 0,

    @Column(nullable = false, columnDefinition = "TEXT")
    var code: String = "",

    @Column(columnDefinition = "TEXT")
    var notes: String? = "",

    @Column(name = "interviewer_chat", columnDefinition = "TEXT")
    var interviewerChat: String? = "[]",

    @Column(name = "briefing_markdown", columnDefinition = "TEXT")
    var briefingMarkdown: String? = "",

    @Column(name = "candidate_key_history", columnDefinition = "TEXT")
    var candidateKeyHistory: String? = "[]",

    @Column(name = "private_notes_json", columnDefinition = "TEXT")
    var privateNotesJson: String? = null,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @OneToMany(mappedBy = "room", cascade = [CascadeType.ALL], orphanRemoval = true)
    @OrderBy("stepIndex ASC")
    var tasks: MutableList<RoomTask> = mutableListOf(),

    @Column(nullable = true, length = 32)
    var verdict: String? = null,

    @Column(name = "verdict_comment", columnDefinition = "TEXT", nullable = true)
    var verdictComment: String? = null,

    @Column(nullable = true, length = 32)
    var status: String? = null,

    @Column(name = "finished_at", nullable = true)
    var finishedAt: java.time.Instant? = null,

    @Column(name = "candidate_name", length = 200)
    var candidateName: String? = null,

    @Column(length = 200)
    var position: String? = null,

    @Column(name = "scheduled_at")
    var scheduledAt: Instant? = null,

    @Column(name = "archived_at")
    var archivedAt: Instant? = null,

    @Column(name = "interview_metadata_revision", nullable = false)
    var interviewMetadataRevision: Long = 0,
)
