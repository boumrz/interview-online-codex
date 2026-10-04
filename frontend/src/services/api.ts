import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AdminUser,
  AgentPolicyGateResult,
  AgentRun,
  AuthResponse,
  CreateTeamResponse,
  CreateGuestRoomRequest,
  CreateRoomRequest,
  EnvironmentDoctorReport,
  HrInterview,
  HrInterviewPage,
  HrManager,
  HiringManagerPreviewResponse,
  InterviewMetadata,
  PresetDetail,
  PresetSummary,
  Room,
  RoomSummary,
  RoomTaskWorkspace,
  TaskLanguageGroup,
  TaskTemplate,
  User,
  UpdateProfileRequest,
  TeamDetail,
  TeamInterviewListResponse,
  TeamInterviewOwnerOfferListResponse,
  TeamInterviewOwnerOfferResponse,
  TeamInterviewProgrammeResponse,
  TeamInterviewResponse,
  TeamInterviewDetails,
  TeamMemberDirectoryPage,
  TeamMemberDirectoryQuery,
  TeamProcessListResponse,
  TeamMergeRedirect,
  TeamMemberLifecycleResponse,
  TeamMemberRoleResponse,
  TeamOwnershipTransferResponse,
  TeamRenameResponse,
  TeamTaskLibraryResponse,
  TeamTaskSetLibraryResponse,
  TeamTaskSetResponse,
  TeamTaskTemplateResponse,
  TeamTrackResponse,
  TeamTracksResponse,
  TeamVacancyResponse,
  WorkspaceCacheScope,
  WorkspaceSummary,
} from "../types";
import type { RootState } from "../app/store";
import { API_BASE_URL } from "../config/runtime";

const API_URL = API_BASE_URL;
type TeamManagementScope = Pick<WorkspaceCacheScope, "accountId" | "kind" | "teamId" | "query">;
type TeamTrackListScope = TeamManagementScope & { status?: "active" | "archived"; q?: string };
type TeamTaskLibraryScope = TeamManagementScope & { language?: string; q?: string };
type TeamTaskSetLibraryScope = TeamManagementScope;
type TeamInterviewListScope = TeamManagementScope & { q?: string; ownership?: "all" | "orphaned"; trackId?: string; vacancyId?: string };
type TeamProcessInterviewScope = Pick<WorkspaceCacheScope, "accountId" | "teamId"> & {
  trackId: string;
  vacancyId?: string | null;
};
type TeamInterviewOwnerOfferScope = TeamManagementScope & { status?: "pending" };

function teamManagementTags(scope: TeamManagementScope) {
  return [
    { type: "TeamDetail" as const, id: `${scope.accountId}:${scope.kind}:${scope.teamId}:${scope.query}` },
    { type: "TeamMembers" as const },
    { type: "Workspaces" as const, id: `account:${scope.accountId}` },
  ];
}

function teamTrackTags(scope: TeamManagementScope) {
  return [
    { type: "TeamTracks" as const, id: `${scope.accountId}:${scope.teamId}:active` },
    { type: "TeamTracks" as const, id: `${scope.accountId}:${scope.teamId}:archived` },
  ];
}

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: API_URL,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.token;
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: [
    "Room",
    "MyRooms",
    "Tasks",
    "AdminUsers",
    "Presets",
    "Profile",
    "HrInterviews",
    "InterviewMetadata",
    "HrManagers",
    "Workspaces",
    "TeamDetail",
    "TeamMembers",
    "TeamInterviews",
    "TeamInterviewOwnerOffers",
    "TeamTracks",
    "TeamTaskLibrary",
    "TeamTaskSets",
  ],
  endpoints: (builder) => ({
    register: builder.mutation<
      AuthResponse,
      { nickname: string; displayName: string; password: string; isHr?: boolean }
    >({
      query: (body) => ({ url: "/auth/register", method: "POST", body }),
    }),
    login: builder.mutation<
      AuthResponse,
      { nickname: string; password: string }
    >({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
    }),
    meProfile: builder.query<User, string>({
      query: () => ({ url: "/me/profile", cache: "no-store" }),
      providesTags: ["Profile"],
    }),
    getWorkspaces: builder.query<WorkspaceSummary[], WorkspaceCacheScope>({
      query: () => ({ url: "/me/workspaces", cache: "no-store" }),
      providesTags: (_result, _error, scope) => [
        { type: "Workspaces", id: `account:${scope.accountId}` },
        { type: "Workspaces", id: `scope:${scope.accountId}:${scope.kind}:${scope.teamId}:${scope.query}` },
      ],
      keepUnusedDataFor: 0,
    }),
    getTeamDetail: builder.query<TeamDetail, WorkspaceCacheScope>({
      query: ({ teamId }) => ({ url: `/teams/${teamId}`, cache: "no-store" }),
      providesTags: (_result, _error, scope) => [{
        type: "TeamDetail",
        id: `${scope.accountId}:${scope.kind}:${scope.teamId}:${scope.query}`,
      }],
      keepUnusedDataFor: 0,
    }),
    getTeamMembers: builder.query<TeamMemberDirectoryPage, TeamMemberDirectoryQuery>({
      query: ({ teamId, page, size, q, state }) => ({
        url: `/teams/${teamId}/members`,
        params: {
          page,
          size,
          ...(q ? { q } : {}),
          ...(state ? { state } : {}),
        },
        cache: "no-store",
      }),
      providesTags: (_result, _error, query) => [{
        type: "TeamMembers",
        id: `${query.teamId}:${query.page}:${query.size}:${query.q ?? ""}:${query.state ?? "ACTIVE"}`,
      }],
      keepUnusedDataFor: 0,
    }),
    getTeamInterviews: builder.query<TeamInterviewListResponse, TeamInterviewListScope>({
      query: ({ teamId, q, ownership, trackId, vacancyId }) => ({
        url: `/teams/${teamId}/interviews`,
        params: {
          ...(q ? { q } : {}),
          ...(ownership ? { ownership } : {}),
          ...(trackId ? { trackId } : {}),
          ...(vacancyId ? { vacancyId } : {}),
        },
        cache: "no-store",
      }),
      providesTags: (_result, _error, scope) => [
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}:${scope.q ?? ""}:${scope.ownership ?? "all"}:${scope.trackId ?? ""}:${scope.vacancyId ?? ""}` },
      ],
      keepUnusedDataFor: 0,
    }),
    getTeamProcesses: builder.query<TeamProcessListResponse, Pick<WorkspaceCacheScope, "accountId" | "teamId">>({
      query: ({ teamId }) => ({ url: `/teams/${teamId}/processes`, cache: "no-store" }),
      keepUnusedDataFor: 0,
    }),
    getTeamProcessInterviews: builder.query<TeamInterviewListResponse, TeamProcessInterviewScope>({
      query: ({ teamId, trackId, vacancyId }) => ({
        url: `/teams/${teamId}/processes/interviews`,
        params: { trackId, ...(vacancyId ? { vacancyId } : {}) },
        cache: "no-store",
      }),
      keepUnusedDataFor: 0,
    }),
    getTeamMergeRedirect: builder.query<TeamMergeRedirect, Pick<WorkspaceCacheScope, "accountId" | "teamId">>({
      query: ({ teamId }) => ({ url: `/teams/${teamId}/redirect`, cache: "no-store" }),
      keepUnusedDataFor: 0,
    }),
    getTeamInterviewOwnerOffers: builder.query<TeamInterviewOwnerOfferListResponse, TeamInterviewOwnerOfferScope>({
      query: ({ teamId, status }) => ({
        url: `/teams/${teamId}/interview-owner-offers`,
        params: {
          ...(status ? { status } : {}),
        },
        cache: "no-store",
      }),
      providesTags: (_result, _error, scope) => [{
        type: "TeamInterviewOwnerOffers",
        id: `${scope.accountId}:${scope.teamId}:${scope.status ?? "pending"}`,
      }],
      keepUnusedDataFor: 0,
    }),
    createTeamInterviewOwnerOffer: builder.mutation<
      TeamInterviewOwnerOfferResponse,
      TeamManagementScope & { interviewId: string; targetUserId: string; idempotencyKey: string }
    >({
      query: ({ teamId, interviewId, targetUserId, idempotencyKey }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}/owner-offers`,
        method: "POST",
        body: { targetUserId },
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    acceptTeamInterviewOwnerOffer: builder.mutation<
      TeamInterviewOwnerOfferResponse,
      TeamManagementScope & { interviewId: string; offerId: string }
    >({
      query: ({ teamId, interviewId, offerId }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}/owner-offers/${offerId}/accept`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    declineTeamInterviewOwnerOffer: builder.mutation<
      TeamInterviewOwnerOfferResponse,
      TeamManagementScope & { interviewId: string; offerId: string }
    >({
      query: ({ teamId, interviewId, offerId }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}/owner-offers/${offerId}/decline`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    archiveTeamInterview: builder.mutation<
      TeamInterviewResponse,
      TeamManagementScope & { interviewId: string }
    >({
      query: ({ teamId, interviewId }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}/archive`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    deleteTeamInterview: builder.mutation<void, TeamManagementScope & { interviewId: string }>({
      query: ({ teamId, interviewId }) => ({ url: `/teams/${teamId}/interviews/${interviewId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    freezeTeamInterview: builder.mutation<
      TeamInterviewResponse,
      TeamManagementScope & { interviewId: string }
    >({
      query: ({ teamId, interviewId }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}/freeze`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    resumeTeamInterview: builder.mutation<
      TeamInterviewResponse,
      TeamManagementScope & { interviewId: string }
    >({
      query: ({ teamId, interviewId }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}/resume`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
      ],
    }),
    getTeamTaskLibrary: builder.query<TeamTaskLibraryResponse, TeamTaskLibraryScope>({
      query: ({ teamId, language, q }) => ({
        url: `/teams/${teamId}/tasks`,
        params: {
          ...(language ? { language } : {}),
          ...(q ? { q } : {}),
        },
        cache: "no-store",
      }),
      providesTags: (_result, _error, scope) => [
        { type: "TeamTaskLibrary", id: `${scope.accountId}:${scope.teamId}` },
        { type: "TeamTaskLibrary", id: `${scope.accountId}:${scope.teamId}:${scope.language ?? ""}:${scope.q ?? ""}` },
      ],
      keepUnusedDataFor: 0,
    }),
    createTeamTask: builder.mutation<
      TeamTaskTemplateResponse,
      TeamManagementScope & { title: string; description?: string; starterCode?: string; language: string }
    >({
      query: ({ teamId, title, description, starterCode, language }) => ({
        url: `/teams/${teamId}/tasks`,
        method: "POST",
        body: { title, description, starterCode, language },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskLibrary",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),
    importPersonalTaskToTeam: builder.mutation<
      TeamTaskTemplateResponse,
      TeamManagementScope & { sourceTaskId: string }
    >({
      query: ({ teamId, sourceTaskId }) => ({
        url: `/teams/${teamId}/tasks/import-personal`,
        method: "POST",
        body: { sourceTaskId },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskLibrary",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),
    copyTeamTask: builder.mutation<
      TeamTaskTemplateResponse,
      TeamManagementScope & { taskId: string }
    >({
      query: ({ teamId, taskId }) => ({
        url: `/teams/${teamId}/tasks/${taskId}/copy`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskLibrary",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),
    updateTeamTask: builder.mutation<
      TeamTaskTemplateResponse,
      TeamManagementScope & {
        taskId: string;
        title: string;
        description?: string;
        starterCode?: string;
        language: string;
        revision: number;
      }
    >({
      query: ({ teamId, taskId, title, description, starterCode, language, revision }) => ({
        url: `/teams/${teamId}/tasks/${taskId}`,
        method: "PATCH",
        body: { title, description, starterCode, language, revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskLibrary",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),


    deleteTeamTask: builder.mutation<void, TeamManagementScope & { taskId: string }>({
      query: ({ teamId, taskId }) => ({ url: `/teams/${teamId}/tasks/${taskId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamTaskLibrary", id: `${scope.accountId}:${scope.teamId}` },
        { type: "TeamTaskSets", id: `${scope.accountId}:${scope.teamId}` },
        ...teamTrackTags(scope),
      ],
    }),
    getTeamTaskSets: builder.query<TeamTaskSetLibraryResponse, TeamTaskSetLibraryScope>({
      query: ({ teamId }) => ({
        url: `/teams/${teamId}/task-sets`,
        cache: "no-store",
      }),
      providesTags: (_result, _error, scope) => [
        { type: "TeamTaskSets", id: `${scope.accountId}:${scope.teamId}` },
      ],
      keepUnusedDataFor: 0,
    }),
    createTeamTaskSet: builder.mutation<
      TeamTaskSetResponse,
      TeamManagementScope & { name: string; taskIds: string[] }
    >({
      query: ({ teamId, name, taskIds }) => ({
        url: `/teams/${teamId}/task-sets`,
        method: "POST",
        body: { name, taskIds },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskSets",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),
    updateTeamTaskSet: builder.mutation<
      TeamTaskSetResponse,
      TeamManagementScope & { setId: string; name: string; taskIds: string[]; revision: number }
    >({
      query: ({ teamId, setId, name, taskIds, revision }) => ({
        url: `/teams/${teamId}/task-sets/${setId}`,
        method: "PATCH",
        body: { name, taskIds, revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskSets",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),
    importPersonalPresetToTeam: builder.mutation<
      TeamTaskSetResponse,
      TeamManagementScope & { sourcePresetId: string }
    >({
      query: ({ teamId, sourcePresetId }) => ({
        url: `/teams/${teamId}/task-sets/import-personal`,
        method: "POST",
        body: { sourcePresetId },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        {
          type: "TeamTaskSets",
          id: `${scope.accountId}:${scope.teamId}`,
        },
        {
          type: "TeamTaskLibrary",
          id: `${scope.accountId}:${scope.teamId}`,
        },
      ],
    }),
    copyTeamTaskSet: builder.mutation<
      TeamTaskSetResponse,
      TeamManagementScope & { setId: string }
    >({
      query: ({ teamId, setId }) => ({
        url: `/teams/${teamId}/task-sets/${setId}/copy`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTaskSets",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),


    deleteTeamTaskSet: builder.mutation<void, TeamManagementScope & { setId: string }>({
      query: ({ teamId, setId }) => ({ url: `/teams/${teamId}/task-sets/${setId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, scope) => [{ type: "TeamTaskSets", id: `${scope.accountId}:${scope.teamId}` }],
    }),
    getTeamTracks: builder.query<TeamTracksResponse, TeamTrackListScope>({
      query: ({ teamId, status, q }) => ({
        url: `/teams/${teamId}/tracks`,
        params: {
          ...(status ? { status } : {}),
          ...(q ? { q } : {}),
        },
        cache: "no-store",
      }),
      providesTags: (_result, _error, scope) => [{
        type: "TeamTracks",
        id: `${scope.accountId}:${scope.teamId}:${scope.status ?? "active"}:${scope.q ?? ""}`,
      }],
      keepUnusedDataFor: 0,
    }),
    createTeamTrack: builder.mutation<
      TeamTrackResponse,
      TeamManagementScope & { name: string }
    >({
      query: ({ teamId, name }) => ({
        url: `/teams/${teamId}/tracks`,
        method: "POST",
        body: { name },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTracks",
        id: `${scope.accountId}:${scope.teamId}:active`,
      }],
    }),
    updateTeamTrack: builder.mutation<
      TeamTrackResponse,
      TeamManagementScope & { trackId: string; name: string; revision: number; status?: "active" | "archived" }
    >({
      query: ({ teamId, trackId, name, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}`,
        method: "PATCH",
        body: { name, revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTracks",
        id: `${scope.accountId}:${scope.teamId}:${scope.status ?? "active"}`,
      }],
    }),
    archiveTeamTrack: builder.mutation<
      TeamTrackResponse,
      TeamManagementScope & { trackId: string }
    >({
      query: ({ teamId, trackId }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/archive`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:active` },
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:archived` },
      ],
    }),
    restoreTeamTrack: builder.mutation<
      TeamTrackResponse,
      TeamManagementScope & { trackId: string }
    >({
      query: ({ teamId, trackId }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/restore`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:active` },
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:archived` },
      ],
    }),
    deleteTeamTrack: builder.mutation<void, TeamManagementScope & { trackId: string }>({
      query: ({ teamId, trackId }) => ({ url: `/teams/${teamId}/tracks/${trackId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    createTeamVacancy: builder.mutation<
      TeamVacancyResponse,
      TeamManagementScope & { trackId: string; title: string }
    >({
      query: ({ teamId, trackId, title }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies`,
        method: "POST",
        body: { title },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTracks",
        id: `${scope.accountId}:${scope.teamId}:active`,
      }],
    }),
    updateTeamVacancy: builder.mutation<
      TeamVacancyResponse,
      TeamManagementScope & { trackId: string; vacancyId: string; title: string; revision: number; status?: "active" | "archived" }
    >({
      query: ({ teamId, trackId, vacancyId, title, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}`,
        method: "PATCH",
        body: { title, revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamTracks",
        id: `${scope.accountId}:${scope.teamId}:${scope.status ?? "active"}`,
      }],
    }),
    archiveTeamVacancy: builder.mutation<
      TeamVacancyResponse,
      TeamManagementScope & { trackId: string; vacancyId: string }
    >({
      query: ({ teamId, trackId, vacancyId }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}/archive`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:active` },
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:archived` },
      ],
    }),
    restoreTeamVacancy: builder.mutation<
      TeamVacancyResponse,
      TeamManagementScope & { trackId: string; vacancyId: string }
    >({
      query: ({ teamId, trackId, vacancyId }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}/restore`,
        method: "POST",
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:active` },
        { type: "TeamTracks", id: `${scope.accountId}:${scope.teamId}:archived` },
      ],
    }),
    deleteTeamVacancy: builder.mutation<void, TeamManagementScope & { trackId: string; vacancyId: string }>({
      query: ({ teamId, trackId, vacancyId }) => ({ url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    saveTeamTrackProgrammeDraft: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; taskIds: string[]; revision?: number | null }
    >({
      query: ({ teamId, trackId, taskIds, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/programme/draft`,
        method: "PATCH",
        body: {
          taskIds,
          ...(revision === null || revision === undefined ? {} : { revision }),
        },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    publishTeamTrackProgramme: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; revision: number }
    >({
      query: ({ teamId, trackId, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/programme/publish`,
        method: "POST",
        body: { revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    archiveTeamTrackProgramme: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; revision: number }
    >({
      query: ({ teamId, trackId, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/programme/archive`,
        method: "POST",
        body: { revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    restoreTeamTrackProgramme: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; revision: number }
    >({
      query: ({ teamId, trackId, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/programme/restore`,
        method: "POST",
        body: { revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    saveTeamVacancyProgrammeDraft: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; vacancyId: string; taskIds: string[]; revision?: number | null }
    >({
      query: ({ teamId, trackId, vacancyId, taskIds, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}/programme/draft`,
        method: "PATCH",
        body: {
          taskIds,
          ...(revision === null || revision === undefined ? {} : { revision }),
        },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    publishTeamVacancyProgramme: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; vacancyId: string; revision: number }
    >({
      query: ({ teamId, trackId, vacancyId, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}/programme/publish`,
        method: "POST",
        body: { revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    archiveTeamVacancyProgramme: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; vacancyId: string; revision: number }
    >({
      query: ({ teamId, trackId, vacancyId, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}/programme/archive`,
        method: "POST",
        body: { revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    restoreTeamVacancyProgramme: builder.mutation<
      TeamInterviewProgrammeResponse,
      TeamManagementScope & { trackId: string; vacancyId: string; revision: number }
    >({
      query: ({ teamId, trackId, vacancyId, revision }) => ({
        url: `/teams/${teamId}/tracks/${trackId}/vacancies/${vacancyId}/programme/restore`,
        method: "POST",
        body: { revision },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => teamTrackTags(scope),
    }),
    renameTeam: builder.mutation<
      TeamRenameResponse,
      TeamManagementScope & { name: string; revision: number; idempotencyKey: string }
    >({
      query: ({ teamId, name, revision, idempotencyKey }) => ({
        url: `/teams/${teamId}`,
        method: "PATCH",
        body: { name, revision },
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => teamManagementTags(scope),
    }),
    updateTeamMemberRole: builder.mutation<
      TeamMemberRoleResponse,
      TeamManagementScope & { userId: string; role: "ADMIN" | "MEMBER"; revision: number; idempotencyKey: string }
    >({
      query: ({ teamId, userId, role, revision, idempotencyKey }) => ({
        url: `/teams/${teamId}/members/${userId}`,
        method: "PATCH",
        body: { role, revision },
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => teamManagementTags(scope),
    }),
    leaveTeam: builder.mutation<
      TeamMemberLifecycleResponse,
      TeamManagementScope & { idempotencyKey: string }
    >({
      query: ({ teamId, idempotencyKey }) => ({
        url: `/teams/${teamId}/leave`,
        method: "POST",
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => teamManagementTags(scope),
    }),
    removeTeamMember: builder.mutation<
      TeamMemberLifecycleResponse,
      TeamManagementScope & { userId: string; idempotencyKey: string }
    >({
      query: ({ teamId, userId, idempotencyKey }) => ({
        url: `/teams/${teamId}/members/${userId}`,
        method: "DELETE",
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => teamManagementTags(scope),
    }),
    transferTeamOwnership: builder.mutation<
      TeamOwnershipTransferResponse,
      TeamManagementScope & { targetUserId: string; revision: number; idempotencyKey: string }
    >({
      query: ({ teamId, targetUserId, revision, idempotencyKey }) => ({
        url: `/teams/${teamId}/ownership-transfer`,
        method: "POST",
        body: { targetUserId, revision },
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => teamManagementTags(scope),
    }),
    createTeamInterview: builder.mutation<
      TeamInterviewResponse,
      TeamManagementScope & {
        title: string;
        taskSetId?: string;
        candidateName?: string | null;
        position?: string | null;
        scheduledAt?: string | null;
        taskIds?: readonly string[];
        selectedTaskIds?: readonly string[];
        trackId?: string;
        vacancyId?: string;
        programmeId?: string;
        programmeVersion?: number;
        interviewerIds?: readonly string[];
        hiringManagerIds?: readonly string[];
        candidateIds?: readonly string[];
        idempotencyKey: string;
      }
    >({
      query: ({ teamId, title, candidateName, position, scheduledAt, taskSetId, taskIds, selectedTaskIds, trackId, vacancyId, programmeId, programmeVersion, interviewerIds, candidateIds, hiringManagerIds, idempotencyKey }) => ({
        url: `/teams/${teamId}/interviews`,
        method: "POST",
        body: {
          title,
          ...(candidateName ? { candidateName } : {}),
          ...(position ? { position } : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
          ...(taskSetId ? { taskSetId } : {}),
          ...(taskIds && taskIds.length > 0 ? { taskIds } : {}),
          ...(selectedTaskIds ? { selectedTaskIds } : {}),
          ...(trackId ? { trackId } : {}),
          ...(vacancyId ? { vacancyId } : {}),
          ...(programmeId ? { programmeId, programmeVersion } : {}),
          ...(interviewerIds && interviewerIds.length > 0 ? { interviewerIds } : {}),
          ...(hiringManagerIds && hiringManagerIds.length > 0 ? { hiringManagerIds } : {}),
          ...(candidateIds && candidateIds.length > 0 ? { candidateIds } : {}),
        },
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => [{
        type: "TeamInterviews",
        id: `${scope.accountId}:${scope.teamId}`,
      }],
    }),
    getTeamInterviewDetails: builder.query<TeamInterviewDetails, TeamManagementScope & { interviewId: string; requestGeneration?: number }>({
      query: ({ teamId, interviewId }) => ({ url: `/teams/${teamId}/interviews/${interviewId}/details`, cache: "no-store" }),
    }),
    updateTeamInterviewDetails: builder.mutation<TeamInterviewDetails, TeamManagementScope & { interviewId: string; details: TeamInterviewDetails }>({
      query: ({ teamId, interviewId, details }) => ({ url: `/teams/${teamId}/interviews/${interviewId}/details`, method: "PATCH", body: details, cache: "no-store" }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        "InterviewMetadata", "HrInterviews", "Room",
      ],
    }),
    renameTeamInterview: builder.mutation<
      TeamInterviewResponse,
      TeamManagementScope & { interviewId: string; title: string }
    >({
      query: ({ teamId, interviewId, title }) => ({
        url: `/teams/${teamId}/interviews/${interviewId}`,
        method: "PATCH",
        body: { title },
        cache: "no-store",
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "TeamInterviews", id: `${scope.accountId}:${scope.teamId}` },
        { type: "TeamInterviewOwnerOffers", id: `${scope.accountId}:${scope.teamId}:pending` },
        "Room",
      ],
    }),
    createTeam: builder.mutation<
      CreateTeamResponse,
      WorkspaceCacheScope & { name: string; idempotencyKey: string }
    >({
      query: ({ name, idempotencyKey }) => ({
        url: "/teams",
        method: "POST",
        body: { name },
        cache: "no-store",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      invalidatesTags: (_result, _error, scope) => [
        { type: "Workspaces", id: `account:${scope.accountId}` },
      ],
    }),
    createGuestRoom: builder.mutation<
      Room,
      CreateGuestRoomRequest
    >({
      query: (body) => ({ url: "/public/rooms", method: "POST", body }),
      invalidatesTags: ["Room"],
    }),
    createRoom: builder.mutation<Room, CreateRoomRequest>({
      query: (body) => ({ url: "/rooms", method: "POST", body }),
      invalidatesTags: ["MyRooms"],
    }),
    getHiringManagerOptions: builder.query<HiringManagerPreviewResponse[], { accountId: string; teamId?: string }>({
      query: ({ teamId }) => ({ url: "/me/hiring-manager-options", params: teamId ? { teamId } : undefined, cache: "no-store" }),
      providesTags: ["Profile", "TeamMembers"],
      keepUnusedDataFor: 0,
    }),
    previewHiringManager: builder.mutation<
      HiringManagerPreviewResponse,
      { invitationId: string; teamId?: string }
    >({
      query: (body) => ({
        url: "/me/hiring-manager-preview",
        method: "POST",
        body,
        cache: "no-store",
      }),
    }),
    getRoom: builder.query<Room, { inviteCode: string; ownerToken?: string }>({
      query: ({ inviteCode, ownerToken }) => ({
        url: `/rooms/${inviteCode}`,
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
        },
      }),
      providesTags: ["Room"],
    }),
    getRoomTaskWorkspace: builder.query<
      RoomTaskWorkspace,
      { inviteCode: string; stepIndex: number; ownerToken?: string; eventToken?: string }
    >({
      query: ({ inviteCode, stepIndex, ownerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/tasks/${stepIndex}/workspace`,
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
        }),
      }),
      updateRoomTaskWorkspace: builder.mutation<
        RoomTaskWorkspace,
        {
          inviteCode: string;
          stepIndex: number;
          ownerToken?: string;
          eventToken?: string;
          code?: string;
          language?: string;
          briefingMarkdown?: string;
          revision: number;
        }
      >({
        query: ({ inviteCode, stepIndex, ownerToken, eventToken, ...body }) => ({
          url: `/rooms/${inviteCode}/tasks/${stepIndex}/workspace`,
          method: "PUT",
          body,
          headers: {
            ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
            ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
          },
        }),
      }),
    addRoomTasks: builder.mutation<
      Room,
      {
        inviteCode: string;
        taskIds?: string[];
        customTasks?: Array<{
          title: string;
          description?: string;
          starterCode?: string;
          /**
           * Optional language override for a custom task. Backend falls back
           * to the current room language when omitted/blank.
           */
          language?: string;
        }>;
        ownerToken?: string;
        /** Realtime event token — lets guest interviewers authenticate REST calls. */
        eventToken?: string;
      }
    >({
      query: ({ inviteCode, taskIds = [], customTasks = [], ownerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/tasks`,
        method: "POST",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
        body: { taskIds, customTasks },
      }),
      invalidatesTags: ["Room"],
    }),
    /**
     * In-room task editing. PATCH semantics — only the supplied fields are
     * applied. Currently exposes title editing; designed so we can grow
     * description/language/starterCode without breaking the call sites.
     */
    updateRoomTask: builder.mutation<
      Room,
      {
        inviteCode: string;
        stepIndex: number;
        title?: string;
        ownerToken?: string;
        /** Realtime event token — lets guest interviewers authenticate REST calls. */
        eventToken?: string;
      }
    >({
      query: ({ inviteCode, stepIndex, ownerToken, eventToken, ...body }) => ({
        url: `/rooms/${inviteCode}/tasks/${stepIndex}`,
        method: "PATCH",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
        body,
      }),
      invalidatesTags: ["Room"],
    }),
    deleteRoomTask: builder.mutation<
      Room,
      { inviteCode: string; stepIndex: number; ownerToken?: string; eventToken?: string }
    >({
      query: ({ inviteCode, stepIndex, ownerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/tasks/${stepIndex}`,
        method: "DELETE",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      invalidatesTags: ["Room"],
    }),
    myRooms: builder.query<RoomSummary[], void>({
      query: () => "/me/rooms",
      providesTags: ["MyRooms"],
    }),
    updateRoom: builder.mutation<
      RoomSummary,
      { roomId: string; title: string }
    >({
      query: ({ roomId, title }) => ({
        url: `/me/rooms/${roomId}`,
        method: "PATCH",
        body: { title },
      }),
      invalidatesTags: ["MyRooms"],
    }),
    deleteRoom: builder.mutation<
      { status: string; archived: boolean },
      { roomId: string }
    >({
      query: ({ roomId }) => ({
        url: `/me/rooms/${roomId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["MyRooms"],
    }),
    updateProfile: builder.mutation<
      User,
      UpdateProfileRequest
    >({
      query: (body) => ({
        url: "/me/profile",
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["Profile", "HrInterviews"],
    }),
    getInterviewMetadata: builder.query<
      InterviewMetadata,
      {
        inviteCode: string;
        ownerToken?: string;
        interviewerToken?: string;
        eventToken?: string;
        requestGeneration?: number;
      }
    >({
      query: ({ inviteCode, ownerToken, interviewerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/interview-metadata`,
        cache: "no-store",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      providesTags: ["InterviewMetadata"],
    }),
    updateInterviewMetadata: builder.mutation<
      InterviewMetadata,
      {
        inviteCode: string;
        ownerToken?: string;
        interviewerToken?: string;
        eventToken?: string;
        metadata: InterviewMetadata;
      }
    >({
      query: ({ inviteCode, ownerToken, interviewerToken, eventToken, metadata }) => ({
        url: `/rooms/${inviteCode}/interview-metadata`,
        method: "PUT",
        body: metadata,
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      invalidatesTags: ["InterviewMetadata", "HrInterviews"],
    }),
    getHrManagers: builder.query<
      HrManager[],
      {
        inviteCode: string;
        ownerToken?: string;
        interviewerToken?: string;
        eventToken?: string;
        requestGeneration?: number;
      }
    >({
      query: ({ inviteCode, ownerToken, interviewerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/hr-managers`,
        cache: "no-store",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      providesTags: ["HrManagers"],
    }),
    addHrManager: builder.mutation<
      HrManager[],
      {
        inviteCode: string;
        userId: string;
        ownerToken?: string;
        interviewerToken?: string;
        eventToken?: string;
      }
    >({
      query: ({ inviteCode, userId, ownerToken, interviewerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/hr-managers/${encodeURIComponent(userId.trim())}`,
        method: "PUT",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      invalidatesTags: ["HrManagers", "HrInterviews"],
    }),
    removeHrManager: builder.mutation<
      void,
      {
        inviteCode: string;
        userId: string;
        ownerToken?: string;
        interviewerToken?: string;
        eventToken?: string;
      }
    >({
      query: ({ inviteCode, userId, ownerToken, interviewerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/hr-managers/${encodeURIComponent(userId.trim())}`,
        method: "DELETE",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      invalidatesTags: ["HrManagers", "HrInterviews"],
    }),
    trackHrRoom: builder.mutation<
      { roomId: string; tracked: true },
      { inviteCode: string; ownerToken?: string; eventToken?: string }
    >({
      query: ({ inviteCode, ownerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/hr-tracking`,
        method: "POST",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
      }),
      invalidatesTags: ["HrInterviews"],
    }),
    getHrInterviews: builder.query<
      HrInterviewPage,
      { page: number; size: number; from?: string; to?: string; teamId?: string; trackId?: string; vacancyId?: string }
    >({
      query: ({ page, size, from, to, teamId, trackId, vacancyId }) => ({
        url: "/me/hr/rooms",
        cache: "no-store",
        params: { page, size, ...(from && to ? { from, to } : {}), ...(teamId ? { teamId } : {}), ...(trackId ? { trackId } : {}), ...(vacancyId ? { vacancyId } : {}) },
      }),
      providesTags: ["HrInterviews"],
    }),
    getHrInterview: builder.query<HrInterview, { roomId: string }>({
      query: ({ roomId }) => ({
        url: `/me/hr/rooms/${roomId}`,
        cache: "no-store",
      }),
      providesTags: ["HrInterviews"],
    }),
    tasksGrouped: builder.query<TaskLanguageGroup[], void>({
      query: () => "/me/tasks",
      providesTags: ["Tasks"],
    }),
    createTaskTemplate: builder.mutation<
      TaskTemplate,
      {
        title: string;
        description?: string;
        starterCode?: string;
        language: string;
      }
    >({
      query: (body) => ({ url: "/me/tasks", method: "POST", body }),
      invalidatesTags: ["Tasks"],
    }),
    updateTaskTemplate: builder.mutation<
      TaskTemplate,
      {
        taskId: string;
        title: string;
        description?: string;
        starterCode?: string;
        language: string;
      }
    >({
      query: ({ taskId, ...body }) => ({
        url: `/me/tasks/${taskId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["Tasks"],
    }),
    deleteTaskTemplate: builder.mutation<
      { status: string },
      { taskId: string }
    >({
      query: ({ taskId }) => ({
        url: `/me/tasks/${taskId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Tasks", "Presets"],
    }),
    adminUsers: builder.query<AdminUser[], void>({
      query: () => "/admin/users",
      providesTags: ["AdminUsers"],
    }),
    adminUpdateUserRole: builder.mutation<
      AdminUser,
      { userId: string; role: string }
    >({
      query: ({ userId, role }) => ({
        url: `/admin/users/${userId}/role`,
        method: "PATCH",
        body: { role },
      }),
      invalidatesTags: ["AdminUsers"],
    }),
    adminDeleteUser: builder.mutation<{ status: string }, { userId: string }>({
      query: ({ userId }) => ({
        url: `/admin/users/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["AdminUsers"],
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
      query: (body) => ({ url: "/agent/runs", method: "POST", body }),
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
        body,
      }),
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
        method: "POST",
      }),
    }),
    configureRealtimeFaults: builder.mutation<
      {
        status: string;
        inviteCode: string;
        latencyMs: number;
        dropEveryNthMessage: number;
      },
      { inviteCode: string; latencyMs: number; dropEveryNthMessage: number }
    >({
      query: ({ inviteCode, ...body }) => ({
        url: `/agent/realtime/faults/${inviteCode}`,
        method: "POST",
        body,
      }),
    }),
    clearRealtimeFaults: builder.mutation<
      { status: string; inviteCode: string },
      { inviteCode: string }
    >({
      query: ({ inviteCode }) => ({
        url: `/agent/realtime/faults/${inviteCode}`,
        method: "DELETE",
      }),
    }),
    listAgentRunsByIssue: builder.query<AgentRun[], { linearIssueId: string }>({
      query: ({ linearIssueId }) => `/agent/issues/${linearIssueId}/runs`,
    }),
    evaluateAgentPolicy: builder.query<
      AgentPolicyGateResult,
      { runId: string }
    >({
      query: ({ runId }) => `/agent/runs/${runId}/policy`,
    }),
    getEnvironmentDoctorReport: builder.query<EnvironmentDoctorReport, void>({
      query: () => "/agent/environment/doctor",
    }),
    listPresets: builder.query<PresetSummary[], void>({
      query: () => "/me/presets",
      providesTags: ["Presets"],
    }),
    getPreset: builder.query<PresetDetail, { presetId: string }>({
      query: ({ presetId }) => `/me/presets/${presetId}`,
      providesTags: (_result, _error, { presetId }) => [{ type: "Presets" as const, id: presetId }],
    }),
    createPreset: builder.mutation<PresetDetail, { name: string; taskTemplateIds: string[] }>({
      query: (body) => ({ url: "/me/presets", method: "POST", body }),
      invalidatesTags: ["Presets"],
    }),
    updatePreset: builder.mutation<PresetDetail, { presetId: string; name: string; taskTemplateIds: string[]; revision?: number }>({
      query: ({ presetId, ...body }) => ({ url: `/me/presets/${presetId}`, method: "PUT", body }),
      invalidatesTags: ["Presets"],
    }),
    copyPreset: builder.mutation<PresetDetail, { presetId: string }>({
      query: ({ presetId }) => ({ url: `/me/presets/${presetId}/copy`, method: "POST" }),
      invalidatesTags: ["Presets"],
    }),


    deletePreset: builder.mutation<{ status: string }, { presetId: string }>({
      query: ({ presetId }) => ({ url: `/me/presets/${presetId}`, method: "DELETE" }),
      invalidatesTags: ["Presets"],
    }),
    setVerdict: builder.mutation<
      Room,
      {
        inviteCode: string;
        verdict: string;
        verdictComment?: string;
        ownerToken?: string;
        interviewerToken?: string;
        eventToken?: string;
      }
    >({
      query: ({ inviteCode, verdict, verdictComment, ownerToken, interviewerToken, eventToken }) => ({
        url: `/rooms/${inviteCode}/verdict`,
        method: "POST",
        headers: {
          ...(ownerToken ? { "X-Room-Owner-Token": ownerToken } : {}),
          ...(interviewerToken ? { "X-Room-Interviewer-Token": interviewerToken } : {}),
          ...(eventToken ? { "X-Room-Event-Token": eventToken } : {}),
        },
        body: { verdict, verdictComment },
      }),
      invalidatesTags: ["Room"],
    }),
  }),
});

export const {
  useRegisterMutation,
  useLoginMutation,
  useMeProfileQuery,
  useLazyMeProfileQuery,
  useGetWorkspacesQuery,
  useLazyGetWorkspacesQuery,
  useLazyGetTeamDetailQuery,
  useGetTeamMembersQuery,
  useGetTeamInterviewsQuery,
  useGetTeamProcessesQuery,
  useGetTeamProcessInterviewsQuery,
  useLazyGetTeamMergeRedirectQuery,
  useGetTeamInterviewOwnerOffersQuery,
  useCreateTeamInterviewOwnerOfferMutation,
  useAcceptTeamInterviewOwnerOfferMutation,
  useDeclineTeamInterviewOwnerOfferMutation,
  useArchiveTeamInterviewMutation,
  useDeleteTeamInterviewMutation,
  useFreezeTeamInterviewMutation,
  useResumeTeamInterviewMutation,
  useGetTeamTaskLibraryQuery,
  useCreateTeamTaskMutation,
  useImportPersonalTaskToTeamMutation,
  useCopyTeamTaskMutation,
  useUpdateTeamTaskMutation,
  useDeleteTeamTaskMutation,
  useGetTeamTaskSetsQuery,
  useCreateTeamTaskSetMutation,
  useUpdateTeamTaskSetMutation,
  useImportPersonalPresetToTeamMutation,
  useCopyTeamTaskSetMutation,
  useDeleteTeamTaskSetMutation,
  useGetTeamTracksQuery,
  useCreateTeamTrackMutation,
  useUpdateTeamTrackMutation,
  useArchiveTeamTrackMutation,
  useRestoreTeamTrackMutation,
  useDeleteTeamTrackMutation,
  useCreateTeamVacancyMutation,
  useUpdateTeamVacancyMutation,
  useArchiveTeamVacancyMutation,
  useRestoreTeamVacancyMutation,
  useDeleteTeamVacancyMutation,
  useSaveTeamTrackProgrammeDraftMutation,
  usePublishTeamTrackProgrammeMutation,
  useArchiveTeamTrackProgrammeMutation,
  useRestoreTeamTrackProgrammeMutation,
  useSaveTeamVacancyProgrammeDraftMutation,
  usePublishTeamVacancyProgrammeMutation,
  useArchiveTeamVacancyProgrammeMutation,
  useRestoreTeamVacancyProgrammeMutation,
  useRenameTeamMutation,
  useUpdateTeamMemberRoleMutation,
  useLeaveTeamMutation,
  useRemoveTeamMemberMutation,
  useTransferTeamOwnershipMutation,
  useCreateTeamInterviewMutation,
  useLazyGetTeamInterviewDetailsQuery,
  useUpdateTeamInterviewDetailsMutation,
  useRenameTeamInterviewMutation,
  useCreateTeamMutation,
  useCreateGuestRoomMutation,
  useCreateRoomMutation,
  useGetHiringManagerOptionsQuery,
  usePreviewHiringManagerMutation,
  useGetRoomQuery,
  useGetRoomTaskWorkspaceQuery,
  useUpdateRoomTaskWorkspaceMutation,
  useAddRoomTasksMutation,
  useUpdateRoomTaskMutation,
  useDeleteRoomTaskMutation,
  useMyRoomsQuery,
  useUpdateRoomMutation,
  useDeleteRoomMutation,
  useUpdateProfileMutation,
  useLazyGetInterviewMetadataQuery,
  useGetInterviewMetadataQuery,
  useUpdateInterviewMetadataMutation,
  useLazyGetHrManagersQuery,
  useAddHrManagerMutation,
  useRemoveHrManagerMutation,
  useTrackHrRoomMutation,
  useGetHrInterviewsQuery,
  useLazyGetHrInterviewQuery,
  useTasksGroupedQuery,
  useCreateTaskTemplateMutation,
  useUpdateTaskTemplateMutation,
  useDeleteTaskTemplateMutation,
  useAdminUsersQuery,
  useAdminUpdateUserRoleMutation,
  useAdminDeleteUserMutation,
  useStartAgentRunMutation,
  useTransitionAgentRunMutation,
  useExecuteAllRunReviewersMutation,
  useConfigureRealtimeFaultsMutation,
  useClearRealtimeFaultsMutation,
  useListAgentRunsByIssueQuery,
  useEvaluateAgentPolicyQuery,
  useGetEnvironmentDoctorReportQuery,
  useListPresetsQuery,
  useGetPresetQuery,
  useLazyGetPresetQuery,
  useCreatePresetMutation,
  useUpdatePresetMutation,
  useCopyPresetMutation,
  useDeletePresetMutation,
  useSetVerdictMutation,
} = api;
