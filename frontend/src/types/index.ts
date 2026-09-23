export type User = {
  id: string;
  nickname: string;
  displayName: string;
  role: "user" | "admin" | string;
  isHr: boolean;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export type WorkspaceKind = "PERSONAL" | "TEAM";

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: string;
  epoch: number;
  capabilities: string[];
};

export type TeamDetail = Omit<WorkspaceSummary, "role"> & {
  role: TeamMemberRole;
  revision: number;
};

export type TeamMemberRole = "OWNER" | "ADMIN" | "MEMBER";

export type TeamMemberState = "ACTIVE" | "SUSPENDED" | "LEFT" | "REMOVED";

export type TeamProcessLabel = {
  readonly trackId: string;
  readonly trackName: string;
  readonly vacancyId: string | null;
  readonly vacancyTitle: string | null;
};

export type TeamProcessListResponse = {
  readonly items: readonly TeamProcessLabel[];
};

export type TeamMergeRedirect = { readonly teamId: string };

export type TeamMemberDirectoryItem = {
  readonly userId: string;
  readonly displayName: string;
  readonly role: TeamMemberRole;
  readonly state: TeamMemberState;
  readonly revision: number;
  readonly processes?: readonly TeamProcessLabel[];
};

export type TeamMemberDirectoryPage = {
  readonly items: ReadonlyArray<TeamMemberDirectoryItem>;
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
};

export type TeamMemberDirectoryQuery = {
  readonly accountId: string;
  readonly teamId: string;
  readonly page: number;
  readonly size: number;
  readonly q?: string;
  readonly state?: Extract<TeamMemberState, "ACTIVE" | "SUSPENDED">;
};

export type TeamManagementTeam = {
  readonly id: string;
  readonly name: string;
  readonly role: TeamMemberRole;
  readonly revision: number;
};

export type TeamManagementMember = Omit<TeamMemberDirectoryItem, "state"> & {
  readonly state: TeamMemberState;
};

export type TeamRenameResponse = {
  readonly outcome: "RENAMED" | "UNCHANGED";
  readonly recovered: boolean;
  readonly team: TeamManagementTeam;
};

export type TeamMemberRoleResponse = {
  readonly outcome: "ROLE_UPDATED" | "UNCHANGED";
  readonly recovered: boolean;
  readonly member: TeamManagementMember;
};

export type TeamMemberLifecycleResponse = {
  readonly outcome: "MEMBER_LEFT" | "MEMBER_REMOVED" | "MEMBER_SUSPENDED" | "MEMBER_RESUMED";
  readonly recovered: boolean;
  readonly member: TeamManagementMember;
};

export type TeamOwnershipTransferResponse = {
  readonly outcome: "OWNERSHIP_TRANSFERRED";
  readonly recovered: boolean;
  readonly team: TeamManagementTeam;
  readonly affectedMembers: readonly [TeamManagementMember, TeamManagementMember];
};

export type TeamInterviewProgrammeTask = {
  readonly taskId: string;
  readonly title: string;
  readonly language: string;
  readonly position: number;
  readonly mandatory: boolean;
};

export type TeamInterviewProgramme = {
  readonly id: string;
  readonly origin: "TRACK" | "VACANCY";
  readonly targetType: "TRACK" | "VACANCY";
  readonly targetId: string;
  readonly status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  readonly version: number;
  readonly revision: number;
  readonly mandatory: boolean;
  readonly tasks: readonly TeamInterviewProgrammeTask[];
};

export type TeamInterviewProgrammeResponse = {
  readonly programme: TeamInterviewProgramme | null;
};

export type TeamVacancy = {
  readonly id: string;
  readonly title: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly revision: number;
  readonly programme: TeamInterviewProgramme | null;
};

export type TeamTrack = {
  readonly id: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly revision: number;
  readonly programme: TeamInterviewProgramme | null;
  readonly vacancies: readonly TeamVacancy[];
};

export type TeamTrackCounts = {
  readonly activeTracks: number;
  readonly archivedTracks: number;
  readonly activeVacancies: number;
  readonly archivedVacancies: number;
};

export type TeamTracksResponse = {
  readonly items: readonly TeamTrack[];
  readonly counts: TeamTrackCounts;
};

export type TeamTrackResponse = {
  readonly track: TeamTrack;
};

export type TeamVacancyResponse = {
  readonly vacancy: TeamVacancy;
};

export type TeamTaskTemplate = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly starterCode: string;
  readonly language: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly revision: number;
  readonly createdByUserId: string;
};

export type TeamTaskLibraryCounts = {
  readonly activeTasks: number;
  readonly archivedTasks: number;
};

export type TeamTaskLibraryResponse = {
  readonly items: readonly TeamTaskTemplate[];
  readonly counts: TeamTaskLibraryCounts;
};

export type TeamTaskTemplateResponse = {
  readonly task: TeamTaskTemplate;
};

export type TeamTaskSetItem = {
  readonly taskId: string;
  readonly title: string;
  readonly language: string;
  readonly position: number;
};

export type TeamTaskSet = {
  readonly id: string;
  readonly name: string;
  readonly items: readonly TeamTaskSetItem[];
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly revision: number;
  readonly createdByUserId: string;
};

export type TeamTaskSetCounts = {
  readonly activeSets: number;
  readonly archivedSets: number;
};

export type TeamTaskSetLibraryResponse = {
  readonly items: readonly TeamTaskSet[];
  readonly counts: TeamTaskSetCounts;
};

export type TeamTaskSetResponse = {
  readonly taskSet: TeamTaskSet;
};

export type TeamInterviewTask = {
  readonly stepIndex: number;
  readonly title: string;
  readonly description: string;
  readonly starterCode: string;
  readonly language: string;
  readonly sourceTaskTemplateId: string;
  readonly mandatory: boolean;
};

export type TeamInterviewAssignee = {
  readonly userId: string;
  readonly displayName: string;
  readonly role: "owner" | "interviewer" | "candidate";
};

export type TeamInterview = {
  readonly id: string;
  readonly title: string;
  readonly inviteCode: string;
  readonly teamId: string;
  readonly status: "active" | "frozen" | "finished";
  readonly trackId: string | null;
  readonly vacancyId: string | null;
  readonly taskSetId: string | null;
  readonly taskSetRevision: number | null;
  readonly programmeId: string | null;
  readonly programmeOrigin: "TRACK" | "VACANCY" | null;
  readonly programmeVersion: number | null;
  readonly tasks: readonly TeamInterviewTask[];
  readonly assignees: readonly TeamInterviewAssignee[];
};

export type TeamInterviewResponse = {
  readonly interview: TeamInterview;
};

export type TeamInterviewListTask = {
  readonly stepIndex: number;
  readonly title: string;
  readonly language: string;
  readonly mandatory: boolean;
};

export type TeamInterviewTaskScore = {
  readonly stepIndex: number;
  readonly title: string;
  readonly score: number | null;
};

export type TeamInterviewListItem = {
  readonly id: string;
  readonly title: string;
  readonly inviteCode: string;
  readonly teamId: string;
  readonly status: "active" | "frozen" | "finished";
  readonly ownerUserId: string | null;
  readonly createdByUserId: string | null;
  readonly ownerDisplayName: string | null;
  readonly ownershipState: "ACTIVE" | "OWNER_SUSPENDED" | "OWNER_LEFT" | "OWNER_REMOVED" | "OWNER_MISSING";
  readonly trackId: string | null;
  readonly trackName: string | null;
  readonly vacancyId: string | null;
  readonly vacancyTitle: string | null;
  readonly taskSetId: string | null;
  readonly taskSetRevision: number | null;
  readonly programmeId: string | null;
  readonly programmeOrigin: "TRACK" | "VACANCY" | null;
  readonly programmeVersion: number | null;
  readonly taskCount: number;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly verdict: string | null;
  readonly verdictComment: string | null;
  readonly tasks: readonly TeamInterviewListTask[];
  readonly taskScores: readonly TeamInterviewTaskScore[];
  readonly assignees: readonly TeamInterviewAssignee[];
};

export type TeamInterviewListResponse = {
  readonly items: readonly TeamInterviewListItem[];
};

export type TeamInterviewOwnerOffer = {
  readonly id: string;
  readonly teamId: string;
  readonly interviewId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly respondedAt: string | null;
};

export type TeamInterviewOwnerOfferResponse = {
  readonly offer: TeamInterviewOwnerOffer;
};

export type TeamInterviewOwnerOfferListItem = {
  readonly id: string;
  readonly teamId: string;
  readonly interviewId: string;
  readonly interviewTitle: string;
  readonly fromUserId: string;
  readonly fromDisplayName: string;
  readonly toUserId: string;
  readonly status: "PENDING";
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type TeamInterviewOwnerOfferListResponse = {
  readonly items: readonly TeamInterviewOwnerOfferListItem[];
};

export type CreateTeamResponse = {
  team: Pick<WorkspaceSummary, "id" | "name">;
  membership: {
    role: string;
    state: string;
    epoch: number;
  };
  capabilities: string[];
};

export type WorkspaceCacheScope = {
  accountId: string;
  kind: WorkspaceKind;
  teamId: string;
  query: string;
  generation: number;
};

export type CreateRoomRequest = {
  title: string;
  taskIds: string[];
  hiringManagerIds?: string[];
};

export type CreateGuestRoomRequest = {
  title?: string;
  ownerDisplayName?: string;
  language: string;
};

export type HiringManagerPreviewResponse = {
  normalizedId: string;
  displayName: string;
};

export type UpdateProfileRequest = {
  displayName: string;
  isHr?: boolean;
};

export type RoomTask = {
  stepIndex: number;
  title: string;
  description: string;
  starterCode: string;
  language: string;
  categoryName: string | null;
  score: number | null;
  sourceTaskTemplateId?: string | null;
  mandatory?: boolean;
};

/**
 * A manager-only saved snapshot of a task that is not currently published to
 * the room. It intentionally stays outside the realtime room payload: the
 * candidate and inactive SSE subscribers must not receive other task answers.
 */
export type RoomTaskWorkspace = {
  stepIndex: number;
  title: string;
  language: string;
  code: string;
  briefingMarkdown: string;
  /** Monotonic revision for non-CRDT manager workspace fields. */
  revision?: number;
  /** Full Yjs state retained only for manager subscribers of an inactive task. */
  yjsDocumentBase64?: string | null;
  yjsSequence?: number;
  focusMode?: boolean;
};

export type RoomNoteMessage = {
  id: string;
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate" | string;
  text: string;
  timestampEpochMs: number;
};

export type RoomAccessMember = {
  userId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate" | string;
  isOwner: boolean;
};

export type Room = {
  id: string;
  teamId?: string | null;
  title: string;
  inviteCode: string;
  language: string;
  currentStep: number;
  code: string;
  notes: string;
  notesMessages: RoomNoteMessage[];
  briefingMarkdown: string;
  ownerToken: string | null;
  interviewerToken: string | null;
  role: "owner" | "interviewer" | "candidate" | string;
  isOwner: boolean;
  canManageRoom: boolean;
  canGrantAccess: boolean;
  accessMembers: RoomAccessMember[];
  tasks: RoomTask[];
};

export type RoomSummary = {
  id: string;
  title: string;
  inviteCode: string;
  language: string;
  accessRole: "owner" | "interviewer" | "candidate";
  createdAt: string;
  ownerToken: string | null;
  interviewerToken: string | null;
  verdict?: string | null;
  status?: string;
};

export type InterviewMetadata = {
  candidateName: string | null;
  position: string | null;
  scheduledAt: string | null;
  revision: number;
};

export type HrManager = {
  userId: string;
  displayName: string;
  isOwner: boolean;
};

export type HrTaskScore = {
  taskId: string;
  stepIndex: number;
  title: string;
  score: number | null;
};

export type HrInterview = {
  roomId: string;
  title: string;
  inviteCode: string;
  candidateName: string | null;
  position: string | null;
  scheduledAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  archivedAt: string | null;
  status: "active" | "frozen" | "finished";
  interviewState: "scheduled" | "active" | "finished";
  verdict: string | null;
  verdictComment: string | null;
  effectiveAt: string;
  dateSource: "scheduled" | "finished" | "created";
  taskScores: HrTaskScore[];
};

export type HrInterviewPage = {
  items: HrInterview[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  timezone: "Europe/Moscow";
  from: string | null;
  to: string | null;
};

export type TaskTemplate = {
  id: string;
  title: string;
  description: string;
  starterCode: string;
  language: string;
};

export type TaskLanguageGroup = {
  language: string;
  tasks: TaskTemplate[];
};

export type AdminUser = {
  id: string;
  nickname: string;
  role: "user" | "admin" | string;
  createdAt: string;
  isSystemAdmin: boolean;
};

export type AgentArtifact = {
  id: string;
  type: string;
  key: string | null;
  schemaVersion: string;
  payload: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

export type AgentReviewVerdict = {
  id: string;
  reviewerType: string;
  decision: string;
  isBlocking: boolean;
  summary: string;
  payload: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  linearIssueId: string;
  workflowProvider: string;
  workflowName: string;
  currentState: string;
  allowedTransitions: string[];
  traceId: string;
  requiresHumanApproval: boolean;
  humanApproved: boolean;
  retryCount: number;
  maxRetries: number;
  timeoutSeconds: number;
  assignedRole: string | null;
  lastHandoffReason: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  acceptanceCriteria: string[];
  artifacts: AgentArtifact[];
  verdicts: AgentReviewVerdict[];
};

export type AgentPolicyGateResult = {
  passed: boolean;
  checks: Array<{
    id: string;
    passed: boolean;
    message: string;
  }>;
};

export type EnvironmentDoctorReport = {
  status: "PASS" | "WARN" | "FAIL";
  generatedAt: string;
  checks: Array<{
    key: string;
    status: "PASS" | "WARN" | "FAIL";
    message: string;
    details: Record<string, string>;
  }>;
};

export type PresetItem = {
  taskTemplateId: string;
  title: string;
  language: string;
  position: number;
};

export type PresetSummary = {
  id: string;
  name: string;
  itemCount: number;
  languageCounts: Record<string, number>;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
};

export type PresetDetail = {
  id: string;
  name: string;
  items: PresetItem[];
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
};
