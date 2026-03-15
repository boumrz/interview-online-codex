package com.interviewonline.model

enum class WorkflowState {
    BACKLOG,
    REFINEMENT,
    READY,
    IN_PROGRESS,
    IN_REVIEW,
    QA,
    DONE,
    BLOCKED,
}

object WorkflowStateMachine {
    private val transitions = mapOf(
        WorkflowState.BACKLOG to setOf(WorkflowState.REFINEMENT, WorkflowState.READY, WorkflowState.BLOCKED),
        WorkflowState.REFINEMENT to setOf(WorkflowState.BACKLOG, WorkflowState.READY, WorkflowState.BLOCKED),
        WorkflowState.READY to setOf(WorkflowState.IN_PROGRESS, WorkflowState.BLOCKED),
        WorkflowState.IN_PROGRESS to setOf(WorkflowState.IN_REVIEW, WorkflowState.BLOCKED),
        WorkflowState.IN_REVIEW to setOf(WorkflowState.QA, WorkflowState.IN_PROGRESS, WorkflowState.BLOCKED),
        WorkflowState.QA to setOf(WorkflowState.DONE, WorkflowState.IN_PROGRESS, WorkflowState.BLOCKED),
        WorkflowState.BLOCKED to setOf(WorkflowState.READY, WorkflowState.IN_PROGRESS, WorkflowState.REFINEMENT),
        WorkflowState.DONE to emptySet(),
    )

    fun canTransition(from: WorkflowState, to: WorkflowState): Boolean {
        return transitions[from]?.contains(to) == true
    }

    fun allowedTargets(from: WorkflowState): Set<WorkflowState> {
        return transitions[from].orEmpty()
    }
}
