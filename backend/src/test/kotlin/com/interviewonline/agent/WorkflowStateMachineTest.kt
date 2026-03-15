package com.interviewonline.agent

import com.interviewonline.model.WorkflowState
import com.interviewonline.model.WorkflowStateMachine
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WorkflowStateMachineTest {
    @Test
    fun `allows valid transition to in progress`() {
        assertTrue(WorkflowStateMachine.canTransition(WorkflowState.READY, WorkflowState.IN_PROGRESS))
    }

    @Test
    fun `blocks invalid transition from backlog to done`() {
        assertFalse(WorkflowStateMachine.canTransition(WorkflowState.BACKLOG, WorkflowState.DONE))
    }

    @Test
    fun `blocks transitions from done`() {
        assertFalse(WorkflowStateMachine.canTransition(WorkflowState.DONE, WorkflowState.IN_PROGRESS))
        assertFalse(WorkflowStateMachine.canTransition(WorkflowState.DONE, WorkflowState.BLOCKED))
    }
}
