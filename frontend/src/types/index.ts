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
  accessRole: "owner" | "participant";
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
  status: "active" | "finished";
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
};

export type PresetDetail = {
  id: string;
  name: string;
  items: PresetItem[];
};
