import { API_BASE_URL } from "../../config/runtime";

export type TeamInvitationState = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type TeamInvitationRecoverability = "RECOVERABLE" | "UNRECOVERABLE_LEGACY" | "NOT_APPLICABLE";

/**
 * Deliberately URL-free lifecycle metadata. A bearer URL is parsed only by
 * `revealTeamInvitationLink` and is never placed in this shared type.
 */
export type TeamInvitation = {
  readonly id: string;
  readonly state: TeamInvitationState;
  readonly role: "MEMBER";
  readonly expiresAt: string;
  readonly revision: number;
  readonly canReveal: boolean;
  readonly linkRecoverability: TeamInvitationRecoverability;
};

export type TeamInvitationPage = {
  readonly items: ReadonlyArray<TeamInvitation>;
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
};

export type TeamInvitationPreview = {
  readonly teamName: string;
  readonly role: "MEMBER";
  readonly expiresAt: string;
};

export type TeamInvitationAcceptance = {
  readonly teamId: string;
  readonly outcome: "joined" | "alreadyMember";
};

type RequestMethod = "GET" | "POST";

type RequestOptions = {
  readonly method: RequestMethod;
  readonly token?: string;
  readonly idempotencyKey?: string;
  readonly body?: Readonly<Record<string, unknown>>;
};

export class TeamInvitationRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TeamInvitationRequestError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || !candidate) {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return candidate;
}

function integerField(value: Record<string, unknown>, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return candidate;
}

function booleanField(value: Record<string, unknown>, field: string): boolean {
  const candidate = value[field];
  if (typeof candidate !== "boolean") {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return candidate;
}

function isInvitationState(value: string): value is TeamInvitationState {
  return value === "PENDING" || value === "ACCEPTED" || value === "REVOKED" || value === "EXPIRED";
}

function isRecoverability(value: string): value is TeamInvitationRecoverability {
  return value === "RECOVERABLE" || value === "UNRECOVERABLE_LEGACY" || value === "NOT_APPLICABLE";
}

function parseInvitation(value: unknown): TeamInvitation {
  const envelope = record(value);
  const raw = record(envelope.invitation ?? envelope);
  const state = stringField(raw, "state");
  const role = stringField(raw, "role");
  const linkRecoverability = stringField(raw, "linkRecoverability");
  if (!isInvitationState(state) || role !== "MEMBER" || !isRecoverability(linkRecoverability)) {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return {
    id: stringField(raw, "id"),
    state,
    role,
    expiresAt: stringField(raw, "expiresAt"),
    revision: integerField(raw, "revision"),
    canReveal: booleanField(raw, "canReveal"),
    linkRecoverability,
  };
}

function parseInvitationPage(value: unknown): TeamInvitationPage {
  const raw = record(value);
  if (!Array.isArray(raw.items)) {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  const page = integerField(raw, "page");
  const size = integerField(raw, "size");
  const totalElements = integerField(raw, "totalElements");
  const totalPages = integerField(raw, "totalPages");
  if (page < 0 || size < 1 || totalElements < 0 || totalPages < 0) {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return {
    items: raw.items.map(parseInvitation),
    page,
    size,
    totalElements,
    totalPages,
  };
}

function parseRevealedUrl(value: unknown): string {
  const url = stringField(record(value), "url");
  try {
    // The API base is relative in the browser (`/api`) but can be absolute in
    // other runtime configurations. Resolve both forms against the current
    // browser origin before validating the join URL.
    const browserOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const parsed = new URL(url, new URL(API_BASE_URL, browserOrigin));
    if (parsed.pathname !== "/join/team" || !parsed.hash) throw new Error("Invalid invitation URL");
  } catch {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return url;
}

function parsePreview(value: unknown): TeamInvitationPreview {
  const raw = record(value);
  const role = stringField(raw, "role");
  if (role !== "MEMBER") throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  return {
    teamName: stringField(raw, "teamName"),
    role,
    expiresAt: stringField(raw, "expiresAt"),
  };
}

function parseAcceptance(value: unknown): TeamInvitationAcceptance {
  const raw = record(value);
  const outcome = stringField(raw, "outcome");
  if (outcome !== "joined" && outcome !== "alreadyMember") {
    throw new TeamInvitationRequestError(502, "Получен некорректный ответ сервера");
  }
  return { teamId: stringField(raw, "teamId"), outcome };
}

async function request(path: string, options: RequestOptions): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method,
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    const message = errorPayload && typeof errorPayload.error === "string"
      ? errorPayload.error
      : "Не удалось выполнить действие";
    const code = errorPayload && typeof errorPayload.code === "string"
      ? errorPayload.code
      : undefined;
    throw new TeamInvitationRequestError(response.status, message, code);
  }
  return payload;
}

export async function listTeamInvitations(teamId: string, token: string): Promise<TeamInvitationPage> {
  return parseInvitationPage(await request(`/teams/${teamId}/invitations`, {
    method: "GET",
    token,
  }));
}

export async function revealTeamInvitationLink(teamId: string, invitationId: string, token: string): Promise<string> {
  return parseRevealedUrl(await request(`/teams/${teamId}/invitations/${invitationId}/link`, {
    method: "GET",
    token,
  }));
}

export async function createTeamInvitation(teamId: string, token: string, idempotencyKey: string): Promise<TeamInvitation> {
  return parseInvitation(await request(`/teams/${teamId}/invitations`, {
    method: "POST",
    token,
    idempotencyKey,
    body: {},
  }));
}

export async function reissueTeamInvitation(
  teamId: string,
  invitationId: string,
  revision: number,
  token: string,
  idempotencyKey: string,
): Promise<TeamInvitation> {
  return parseInvitation(await request(`/teams/${teamId}/invitations/${invitationId}/reissue`, {
    method: "POST",
    token,
    idempotencyKey,
    body: { revision },
  }));
}

export async function revokeTeamInvitation(
  teamId: string,
  invitationId: string,
  revision: number,
  token: string,
  idempotencyKey: string,
): Promise<TeamInvitation> {
  return parseInvitation(await request(`/teams/${teamId}/invitations/${invitationId}/revoke`, {
    method: "POST",
    token,
    idempotencyKey,
    body: { revision },
  }));
}

export async function previewTeamInvitation(invitationToken: string, token?: string): Promise<TeamInvitationPreview> {
  return parsePreview(await request("/team-invitations/preview", {
    method: "POST",
    ...(token ? { token } : {}),
    body: { token: invitationToken },
  }));
}

export async function acceptTeamInvitation(
  invitationToken: string,
  token: string,
  idempotencyKey: string,
): Promise<TeamInvitationAcceptance> {
  return parseAcceptance(await request("/team-invitations/accept", {
    method: "POST",
    token,
    idempotencyKey,
    body: { token: invitationToken },
  }));
}
