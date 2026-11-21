import { api } from "../../services/api";
import type {
  LearningProgressModule,
  LearningSource,
  LearningState,
} from "./learningContent";
export type LearningContext = {
  module: LearningProgressModule;
  accountId: string;
  teamId?: string;
  inviteCode?: string;
  sessionId?: string;
  eventToken?: string | null;
};
export type LearningCommand = {
  commandId: string;
  expectedVersion: number;
  expectedRevision: number;
  action:
    | "offer_seen"
    | "offer_skip"
    | "manual_open"
    | "start"
    | "resume"
    | "cancel"
    | "step"
    | "finish";
  source: LearningSource;
  step?: number;
};
function request(context: LearningContext) {
  return {
    url: `/me/learning/${context.module}`,
    params: {
      teamId: context.teamId,
      inviteCode: context.inviteCode,
      sessionId: context.sessionId,
    },
    headers: {
      ...(context.eventToken
        ? { "X-Room-Event-Token": context.eventToken }
        : {}),
    },
  };
}
export const learningApi = api.injectEndpoints({
  endpoints: (builder) => ({
    learningState: builder.query<LearningState, LearningContext>({
      query: request,
      keepUnusedDataFor: 0,
    }),
    learningCommand: builder.mutation<
      { state: LearningState; events: string[] },
      { context: LearningContext; command: LearningCommand }
    >({
      query: ({ context, command }) => ({
        ...request(context),
        method: "POST",
        body: command,
      }),
    }),
  }),
});
export const { useLearningStateQuery, useLearningCommandMutation } =
  learningApi;
