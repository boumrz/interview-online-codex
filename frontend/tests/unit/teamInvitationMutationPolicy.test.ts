import assert from "node:assert/strict";
import { before, test } from "node:test";

type Operation = "accept" | "reissue" | "revoke";
type Failure =
  | { readonly kind: "network" }
  | { readonly kind: "http"; readonly status: number };

type MutationPolicy = (operation: Operation, failure: Failure) => {
  readonly disposition: "retry" | "authenticate" | "terminal";
  readonly preserveIntent: boolean;
  readonly preserveInviteeToken: boolean;
};

let classifyTeamInvitationMutationFailure: MutationPolicy | undefined;

before(async () => {
  try {
    const policy = await import("../../src/features/workspace/teamInvitationMutationPolicy.ts");
    classifyTeamInvitationMutationFailure = policy.classifyTeamInvitationMutationFailure as MutationPolicy | undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
});

const retryableFailures: ReadonlyArray<readonly [string, Failure]> = [
  ["network", { kind: "network" }],
  ["429", { kind: "http", status: 429 }],
  ["representative 503", { kind: "http", status: 503 }],
];

for (const operation of ["accept", "reissue", "revoke"] as const) {
  for (const [failureName, failure] of retryableFailures) {
    test(`AC-03 mutation policy: ${operation} ${failureName} retains one explicit retry intent`, () => {
      assert.equal(
        typeof classifyTeamInvitationMutationFailure,
        "function",
        "AC03_MUTATION_POLICY_PRODUCTION_SEAM_MISSING",
      );
      assert.deepEqual(classifyTeamInvitationMutationFailure?.(operation, failure), {
        disposition: "retry",
        preserveIntent: true,
        preserveInviteeToken: operation === "accept",
      });
    });
  }
}
