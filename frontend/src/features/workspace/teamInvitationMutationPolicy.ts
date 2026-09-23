export type TeamInvitationMutationOperation = "accept" | "reissue" | "revoke";

export type TeamInvitationMutationFailure =
  | { readonly kind: "network" }
  | {
      readonly kind: "http";
      readonly status: number;
      readonly code?: string;
    };

export type TeamInvitationMutationDisposition = {
  readonly disposition: "retry" | "authenticate" | "terminal";
  readonly preserveIntent: boolean;
  readonly preserveInviteeToken: boolean;
};

export function classifyTeamInvitationMutationFailure(
  operation: TeamInvitationMutationOperation,
  failure: TeamInvitationMutationFailure,
): TeamInvitationMutationDisposition {
  const isRetryable = failure.kind === "network"
    || failure.status === 429
    || failure.status >= 500
    || (failure.status === 409 && failure.code === "COMMAND_PENDING");

  if (isRetryable) {
    return {
      disposition: "retry",
      preserveIntent: true,
      preserveInviteeToken: operation === "accept",
    };
  }

  if (operation === "accept" && failure.status === 401) {
    return {
      disposition: "authenticate",
      preserveIntent: false,
      preserveInviteeToken: true,
    };
  }

  if (operation === "accept" && failure.status !== 410) {
    return {
      disposition: "terminal",
      preserveIntent: true,
      preserveInviteeToken: true,
    };
  }

  return {
    disposition: "terminal",
    preserveIntent: false,
    preserveInviteeToken: false,
  };
}
