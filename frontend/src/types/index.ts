export type User = {
  id: string;
  nickname: string;
  displayName: string;
  role: "user" | "admin" | string;
};

export type AuthResponse = {
  token: string;
  user: User;
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
};

export type RunCodeResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
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
