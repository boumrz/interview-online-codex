import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AgentPolicyGateResult,
  AgentRun,
  AuthResponse,
  EnvironmentDoctorReport,
  Room,
  RoomSummary,
  RunCodeResponse,
  TaskLanguageGroup,
  TaskTemplate
} from "../types";
import type { RootState } from "../app/store";

const API_URL = "http://localhost:8080/api";

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: API_URL,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.token;
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return headers;
    }
  }),
  tagTypes: ["Room", "MyRooms", "Tasks"],
  endpoints: (builder) => ({
    register: builder.mutation<AuthResponse, { nickname: string; password: string }>({
      query: (body) => ({ url: "/auth/register", method: "POST", body })
    }),
    login: builder.mutation<AuthResponse, { nickname: string; password: string }>({
      query: (body) => ({ url: "/auth/login", method: "POST", body })
    }),
    createGuestRoom: builder.mutation<Room, { title?: string; ownerDisplayName?: string; language: string }>({
      query: (body) => ({ url: "/public/rooms", method: "POST", body }),
      invalidatesTags: ["Room"]
    }),
    createRoom: builder.mutation<Room, { title: string; language: string; taskIds: string[] }>({
      query: (body) => ({ url: "/rooms", method: "POST", body }),
      invalidatesTags: ["MyRooms"]
    }),
    getRoom: builder.query<Room, { inviteCode: string; ownerToken?: string; interviewerToken?: string }>({
      query: ({ inviteCode, ownerToken, interviewerToken }) => ({
        url: `/rooms/${inviteCode}`,
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {})
        }
      }),
      providesTags: ["Room"]
    }),
    nextStep: builder.mutation<Room, { inviteCode: string; ownerToken: string }>({
      query: ({ inviteCode, ownerToken }) => ({
        url: `/rooms/${inviteCode}/next-step`,
        method: "POST",
        headers: { "X-Room-Owner-Token": ownerToken }
      }),
      invalidatesTags: ["Room"]
    }),
    runCode: builder.mutation<
      RunCodeResponse,
      { inviteCode: string; ownerToken: string; language: string; code: string }
    >({
      query: ({ inviteCode, ownerToken, language, code }) => ({
        url: `/rooms/${inviteCode}/run`,
        method: "POST",
        headers: { "X-Room-Owner-Token": ownerToken },
        body: { language, code }
      })
    }),
    myRooms: builder.query<RoomSummary[], void>({
      query: () => "/me/rooms",
      providesTags: ["MyRooms"]
    }),
    updateRoom: builder.mutation<RoomSummary, { roomId: string; title: string }>({
      query: ({ roomId, title }) => ({
        url: `/me/rooms/${roomId}`,
        method: "PATCH",
        body: { title }
      }),
      invalidatesTags: ["MyRooms"]
    }),
    deleteRoom: builder.mutation<{ status: string }, { roomId: string }>({
      query: ({ roomId }) => ({
        url: `/me/rooms/${roomId}`,
        method: "DELETE"
      }),
      invalidatesTags: ["MyRooms"]
    }),
    tasksGrouped: builder.query<TaskLanguageGroup[], void>({
      query: () => "/me/tasks",
      providesTags: ["Tasks"]
    }),
    createTaskTemplate: builder.mutation<TaskTemplate, { title: string; description: string; starterCode: string; language: string }>({
      query: (body) => ({ url: "/me/tasks", method: "POST", body }),
      invalidatesTags: ["Tasks"]
    }),
    updateTaskTemplate: builder.mutation<
      TaskTemplate,
      { taskId: string; title: string; description: string; starterCode: string; language: string }
    >({
      query: ({ taskId, ...body }) => ({
        url: `/me/tasks/${taskId}`,
        method: "PATCH",
        body
      }),
      invalidatesTags: ["Tasks"]
    }),
    deleteTaskTemplate: builder.mutation<{ status: string }, { taskId: string }>({
      query: ({ taskId }) => ({
        url: `/me/tasks/${taskId}`,
        method: "DELETE"
      }),
      invalidatesTags: ["Tasks"]
    }),
    startAgentRun: builder.mutation<
      AgentRun,
      {
        linearIssueId: string;
        workflowProvider: "temporal" | "langgraph";
        requiresHumanApproval: boolean;
        acceptanceCriteria: string[];
        assignedRole: string;
      }
    >({
      query: (body) => ({ url: "/agent/runs", method: "POST", body })
    }),
    transitionAgentRun: builder.mutation<
      AgentRun,
      {
        runId: string;
        targetState: string;
        handoffReason?: string;
        errorMessage?: string;
        actorRole?: string;
        humanApproved?: boolean;
      }
    >({
      query: ({ runId, ...body }) => ({
        url: `/agent/runs/${runId}/transition`,
        method: "POST",
        body
      })
    }),
    executeAllRunReviewers: builder.mutation<
      Array<{
        id: string;
        reviewerType: string;
        decision: string;
        isBlocking: boolean;
        summary: string;
      }>,
      { runId: string }
    >({
      query: ({ runId }) => ({
        url: `/agent/runs/${runId}/reviewers/execute-all`,
        method: "POST"
      })
    }),
    configureRealtimeFaults: builder.mutation<
      { status: string; inviteCode: string; latencyMs: number; dropEveryNthMessage: number },
      { inviteCode: string; latencyMs: number; dropEveryNthMessage: number }
    >({
      query: ({ inviteCode, ...body }) => ({
        url: `/agent/realtime/faults/${inviteCode}`,
        method: "POST",
        body
      })
    }),
    clearRealtimeFaults: builder.mutation<{ status: string; inviteCode: string }, { inviteCode: string }>({
      query: ({ inviteCode }) => ({
        url: `/agent/realtime/faults/${inviteCode}`,
        method: "DELETE"
      })
    }),
    listAgentRunsByIssue: builder.query<AgentRun[], { linearIssueId: string }>({
      query: ({ linearIssueId }) => `/agent/issues/${linearIssueId}/runs`
    }),
    evaluateAgentPolicy: builder.query<AgentPolicyGateResult, { runId: string }>({
      query: ({ runId }) => `/agent/runs/${runId}/policy`
    }),
    getEnvironmentDoctorReport: builder.query<EnvironmentDoctorReport, void>({
      query: () => "/agent/environment/doctor"
    })
  })
});

export const {
  useRegisterMutation,
  useLoginMutation,
  useCreateGuestRoomMutation,
  useCreateRoomMutation,
  useGetRoomQuery,
  useNextStepMutation,
  useRunCodeMutation,
  useMyRoomsQuery,
  useUpdateRoomMutation,
  useDeleteRoomMutation,
  useTasksGroupedQuery,
  useCreateTaskTemplateMutation,
  useUpdateTaskTemplateMutation,
  useDeleteTaskTemplateMutation,
  useStartAgentRunMutation,
  useTransitionAgentRunMutation,
  useExecuteAllRunReviewersMutation,
  useConfigureRealtimeFaultsMutation,
  useClearRealtimeFaultsMutation,
  useListAgentRunsByIssueQuery,
  useEvaluateAgentPolicyQuery,
  useGetEnvironmentDoctorReportQuery
} = api;
