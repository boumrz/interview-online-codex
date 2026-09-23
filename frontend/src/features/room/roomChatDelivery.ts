export type RoomChatMessage = {
  id: string;
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  text: string;
  timestampEpochMs: number;
};

export type RoomChatAck = {
  type: "note_message_ack";
  status: "persisted";
  clientMessageId: string;
  messageId: string;
  persistedAtEpochMs: number;
};

export type RoomChatDeliveryContext = {
  roomId: string;
  accountId: string;
};

export type RoomChatIntent = {
  clientMessageId: string;
  body: string;
  originalClientEventSequence: number;
  timestampEpochMs: number;
  contextGeneration: number;
  messageId: string | null;
  errorCode: string | null;
  retryAllowed: boolean;
};

export type RoomChatDeliveryState = RoomChatDeliveryContext & {
  contextGeneration: number;
  status: "idle" | "pending" | "retryable_error" | "persisted";
  draft: string;
  intent: RoomChatIntent | null;
  messages: RoomChatMessage[];
};

export type RoomChatContextResetReason =
  | "room_changed"
  | "account_changed"
  | "access_revoked";

export type RoomChatFailure = {
  httpStatus: number;
  code?: string | null;
  clientMessageId: string;
  contextGeneration: number;
};

function sameActiveIntent(
  state: RoomChatDeliveryState,
  clientMessageId: string,
  contextGeneration: number,
): boolean {
  return state.contextGeneration === contextGeneration
    && state.intent?.clientMessageId === clientMessageId;
}

function dedupeMessages(messages: RoomChatMessage[]): RoomChatMessage[] {
  const seen = new Set<string>();
  const result: RoomChatMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }
  return result.sort(
    (left, right) =>
      left.timestampEpochMs - right.timestampEpochMs ||
      left.id.localeCompare(right.id),
  );
}

export function createRoomChatDeliveryState(
  context: RoomChatDeliveryContext,
): RoomChatDeliveryState {
  return {
    ...context,
    contextGeneration: 0,
    status: "idle",
    draft: "",
    intent: null,
    messages: [],
  };
}

export function updateRoomChatDraft(
  state: RoomChatDeliveryState,
  draft: string,
): RoomChatDeliveryState {
  if (state.draft === draft) return state;
  return { ...state, draft };
}

export function beginRoomChatIntent(
  state: RoomChatDeliveryState,
  options: {
    clientEventSequence: number;
    timestampEpochMs: number;
    createClientMessageId: () => string;
  },
): RoomChatDeliveryState {
  const body = state.draft.trim();
  if (!body) return state;
  const clientMessageId = options.createClientMessageId();
  return {
    ...state,
    status: "pending",
    intent: {
      clientMessageId,
      body,
      originalClientEventSequence: options.clientEventSequence,
      timestampEpochMs: options.timestampEpochMs,
      contextGeneration: state.contextGeneration,
      messageId: null,
      errorCode: null,
      retryAllowed: true,
    },
  };
}

export function retryRoomChatIntent(
  state: RoomChatDeliveryState,
): RoomChatDeliveryState {
  if (
    state.status !== "retryable_error" ||
    !state.intent ||
    !state.intent.retryAllowed
  ) {
    return state;
  }
  return {
    ...state,
    status: "pending",
    intent: {
      ...state.intent,
      errorCode: null,
    },
  };
}

export function applyRoomChatAck(
  state: RoomChatDeliveryState,
  ack: RoomChatAck,
  contextGeneration: number,
): RoomChatDeliveryState {
  const activeIntent = state.intent;
  if (!sameActiveIntent(state, ack.clientMessageId, contextGeneration) || !activeIntent) {
    return state;
  }
  const intent = {
    ...activeIntent,
    messageId: ack.messageId,
    errorCode: null,
    retryAllowed: false,
  } satisfies RoomChatIntent;
  return {
    ...state,
    status: "persisted",
    draft: "",
    intent,
    messages: dedupeMessages(
      state.messages.map((message) =>
        message.id === ack.clientMessageId
          ? { ...message, id: ack.messageId }
          : message,
      ),
    ),
  };
}

export function applyRoomChatSseMessage(
  state: RoomChatDeliveryState,
  message: RoomChatMessage,
  contextGeneration: number,
): RoomChatDeliveryState {
  if (state.contextGeneration !== contextGeneration) return state;
  const nextMessages = dedupeMessages([...state.messages, message]);
  if (
    state.intent?.messageId === message.id ||
    state.intent?.clientMessageId === message.id
  ) {
    return {
      ...state,
      status: "persisted",
      draft: "",
      messages: nextMessages,
    };
  }
  if (nextMessages === state.messages) return state;
  return {
    ...state,
    messages: nextMessages,
  };
}

export function applyRoomChatFailure(
  state: RoomChatDeliveryState,
  failure: RoomChatFailure,
): RoomChatDeliveryState {
  if (!sameActiveIntent(
    state,
    failure.clientMessageId,
    failure.contextGeneration,
  )) {
    return state;
  }
  if (failure.httpStatus === 403) {
    return resetRoomChatDeliveryContext(state, {
      reason: "access_revoked",
      roomId: state.roomId,
      accountId: state.accountId,
    });
  }
  return {
    ...state,
    status: "retryable_error",
    draft: state.draft,
    intent: state.intent
      ? {
          ...state.intent,
          errorCode: failure.code ?? null,
          retryAllowed: failure.httpStatus !== 409,
        }
      : null,
  };
}

export function resetRoomChatDeliveryContext(
  state: RoomChatDeliveryState,
  context: RoomChatDeliveryContext & { reason: RoomChatContextResetReason },
): RoomChatDeliveryState {
  return {
    roomId: context.roomId,
    accountId: context.accountId,
    contextGeneration: state.contextGeneration + 1,
    status: "idle",
    draft: "",
    intent: null,
    messages: [],
  };
}
