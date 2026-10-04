import assert from "node:assert/strict";
import { test } from "node:test";

const loadDelivery = () => import("../../src/features/room/roomChatDelivery.ts");

const context = {
  roomId: "room-ac12-a",
  accountId: "account-ac12-a",
};

const ack = (clientMessageId: string, messageId = "message-server-1") => ({
  type: "note_message_ack" as const,
  status: "persisted" as const,
  clientMessageId,
  messageId,
  persistedAtEpochMs: 1_900,
});

test("a new intent owns one normalized body, UUID, timestamp, original sequence and context generation", async () => {
  const {
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    updateRoomChatDraft,
  } = await loadDelivery();
  const initial = createRoomChatDeliveryState(context);
  const drafted = updateRoomChatDraft(initial, "  Сообщение для команды  ");
  const pending = beginRoomChatIntent(drafted, {
    clientEventSequence: 41,
    timestampEpochMs: 1_000,
    createClientMessageId: () => "a14fa345-a0f3-419a-97fd-13ec86b57235",
  });

  assert.equal(initial.status, "idle");
  assert.equal(initial.draft, "", "the source state remains immutable");
  assert.equal(pending.status, "pending");
  assert.equal(pending.draft, "  Сообщение для команды  ");
  assert.deepEqual(pending.intent, {
    clientMessageId: "a14fa345-a0f3-419a-97fd-13ec86b57235",
    body: "Сообщение для команды",
    originalClientEventSequence: 41,
    timestampEpochMs: 1_000,
    contextGeneration: 0,
    submittedDraftRevision: 1,
    messageId: null,
    errorCode: null,
    retryAllowed: true,
  });
});

test("a transient failure and explicit retry preserve the exact immutable delivery envelope", async () => {
  const {
    applyRoomChatFailure,
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    retryRoomChatIntent,
    updateRoomChatDraft,
  } = await loadDelivery();
  const pending = beginRoomChatIntent(
    updateRoomChatDraft(createRoomChatDeliveryState(context), "  Потерянный ACK  "),
    {
      clientEventSequence: 73,
      timestampEpochMs: 2_000,
      createClientMessageId: () => "7b525e2f-a849-4183-a9b8-24aed193b2fc",
    },
  );
  const failed = applyRoomChatFailure(pending, {
    httpStatus: 503,
    code: "CHAT_TEMPORARILY_UNAVAILABLE",
    clientMessageId: pending.intent?.clientMessageId ?? "",
    contextGeneration: 0,
  });
  const retried = retryRoomChatIntent(failed);

  assert.equal(failed.status, "retryable_error");
  assert.equal(failed.draft, "  Потерянный ACK  ");
  assert.deepEqual(
    {
      clientMessageId: retried.intent?.clientMessageId,
      body: retried.intent?.body,
      originalClientEventSequence: retried.intent?.originalClientEventSequence,
      timestampEpochMs: retried.intent?.timestampEpochMs,
      contextGeneration: retried.intent?.contextGeneration,
    },
    {
      clientMessageId: pending.intent?.clientMessageId,
      body: pending.intent?.body,
      originalClientEventSequence: pending.intent?.originalClientEventSequence,
      timestampEpochMs: pending.intent?.timestampEpochMs,
      contextGeneration: pending.intent?.contextGeneration,
    },
  );
  assert.equal(retried.status, "pending");
});

test("only an ACK for the active intent and generation can persist it", async () => {
  const {
    applyRoomChatAck,
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    updateRoomChatDraft,
  } = await loadDelivery();
  const pending = beginRoomChatIntent(
    updateRoomChatDraft(createRoomChatDeliveryState(context), "Подтвердить один раз"),
    {
      clientEventSequence: 9,
      timestampEpochMs: 3_000,
      createClientMessageId: () => "953504b9-198a-41cb-83ff-90d7e933f40f",
    },
  );
  const id = pending.intent?.clientMessageId ?? "";

  assert.strictEqual(
    applyRoomChatAck(pending, ack("9df4d4a3-9305-4481-ac88-f41359895ebc"), 0),
    pending,
    "an ACK for another intent is ignored without a state copy",
  );
  assert.strictEqual(
    applyRoomChatAck(pending, ack(id), 1),
    pending,
    "an ACK from another context generation is ignored",
  );

  const persisted = applyRoomChatAck(pending, ack(id), 0);
  assert.equal(persisted.status, "persisted");
  assert.equal(persisted.intent?.messageId, "message-server-1");
  assert.equal(persisted.draft, "");
});

test("ACK and SSE echo reconcile by server messageId without duplicating the optimistic message", async () => {
  const {
    applyRoomChatAck,
    applyRoomChatSseMessage,
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    updateRoomChatDraft,
  } = await loadDelivery();
  const pending = beginRoomChatIntent(
    updateRoomChatDraft(createRoomChatDeliveryState(context), "Одно сообщение"),
    {
      clientEventSequence: 10,
      timestampEpochMs: 4_000,
      createClientMessageId: () => "56b411f4-c335-4d87-8ed2-5266f2c99619",
    },
  );
  const id = pending.intent?.clientMessageId ?? "";
  const serverMessage = {
    id: "message-server-dedupe",
    sessionId: "manager-session",
    displayName: "Интервьюер",
    role: "interviewer" as const,
    text: "Одно сообщение",
    timestampEpochMs: 4_100,
  };

  const sseFirst = applyRoomChatSseMessage(pending, serverMessage, 0);
  const thenAck = applyRoomChatAck(sseFirst, ack(id, serverMessage.id), 0);
  const ackFirst = applyRoomChatAck(pending, ack(id, serverMessage.id), 0);
  const thenSse = applyRoomChatSseMessage(ackFirst, serverMessage, 0);

  for (const state of [thenAck, thenSse]) {
    assert.equal(state.status, "persisted");
    assert.equal(state.messages.filter((message) => message.id === serverMessage.id).length, 1);
  }
});

for (const followingDraft of ["  Следующий черновик\n", "Первое сообщение"]) {
  test(`ACK and repeated SSE preserve a subsequent draft: ${JSON.stringify(followingDraft)}`, async () => {
    const { applyRoomChatAck, applyRoomChatSseMessage, beginRoomChatIntent,
      createRoomChatDeliveryState, updateRoomChatDraft } = await loadDelivery();
    const pending = beginRoomChatIntent(
      updateRoomChatDraft(createRoomChatDeliveryState(context), "Первое сообщение"),
      { clientEventSequence: 15, timestampEpochMs: 8_000,
        createClientMessageId: () => "draft-preservation-intent" },
    );
    // The composer clears on submission; the user may then write even identical text.
    const following = updateRoomChatDraft(updateRoomChatDraft(pending, ""), followingDraft);
    const confirmed = applyRoomChatAck(following, ack("draft-preservation-intent"), 0);
    assert.equal(confirmed.draft, followingDraft, "ACK must preserve the new draft exactly");
    const echo = { id: "message-server-1", sessionId: "manager-session",
      displayName: "Владелец", role: "owner" as const, text: "Первое сообщение", timestampEpochMs: 8_100 };
    const echoed = applyRoomChatSseMessage(confirmed, echo, 0);
    const repeated = applyRoomChatAck(applyRoomChatSseMessage(echoed, echo, 0), ack("draft-preservation-intent"), 0);
    assert.equal(repeated.draft, followingDraft, "late confirmations must not erase another draft");
    assert.equal(repeated.messages.length, 1);
    assert.equal(repeated.status, "persisted");
  });
}

test("409 stays a local error on the same intent and never invents a replacement UUID", async () => {
  const {
    applyRoomChatFailure,
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    updateRoomChatDraft,
  } = await loadDelivery();
  const pending = beginRoomChatIntent(
    updateRoomChatDraft(createRoomChatDeliveryState(context), "Конфликтующее сообщение"),
    {
      clientEventSequence: 11,
      timestampEpochMs: 5_000,
      createClientMessageId: () => "4bdd0320-7c04-42d8-a8ac-1270e901265f",
    },
  );
  const conflicted = applyRoomChatFailure(pending, {
    httpStatus: 409,
    code: "CLIENT_MESSAGE_ID_REUSED",
    clientMessageId: pending.intent?.clientMessageId ?? "",
    contextGeneration: 0,
  });

  assert.equal(conflicted.status, "retryable_error");
  assert.equal(conflicted.intent?.clientMessageId, pending.intent?.clientMessageId);
  assert.equal(conflicted.intent?.errorCode, "CLIENT_MESSAGE_ID_REUSED");
  assert.equal(conflicted.intent?.retryAllowed, false);
  assert.equal(conflicted.draft, "Конфликтующее сообщение");
});

test("room or account changes clear protected state and make every late ACK stale", async () => {
  const {
    applyRoomChatAck,
    applyRoomChatSseMessage,
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    resetRoomChatDeliveryContext,
    updateRoomChatDraft,
  } = await loadDelivery();
  const pending = beginRoomChatIntent(
    updateRoomChatDraft(createRoomChatDeliveryState(context), "Секрет старого контекста"),
    {
      clientEventSequence: 12,
      timestampEpochMs: 6_000,
      createClientMessageId: () => "3d62beaf-61f3-4c5a-b813-eec1126f6408",
    },
  );
  const withMessage = applyRoomChatSseMessage(pending, {
    id: "old-message",
    sessionId: "old-session",
    displayName: "Старый интервьюер",
    role: "interviewer",
    text: "Старое приватное сообщение",
    timestampEpochMs: 6_100,
  }, 0);
  const next = resetRoomChatDeliveryContext(withMessage, {
    reason: "account_changed",
    roomId: "room-ac12-b",
    accountId: "account-ac12-b",
  });

  assert.equal(next.contextGeneration, 1);
  assert.equal(next.status, "idle");
  assert.equal(next.draft, "");
  assert.equal(next.intent, null);
  assert.deepEqual(next.messages, []);
  assert.strictEqual(
    applyRoomChatAck(next, ack(pending.intent?.clientMessageId ?? "", "late-message"), 0),
    next,
  );
});

test("terminal 403/revoke clears the same protected state and blocks a late response", async () => {
  const {
    applyRoomChatAck,
    applyRoomChatFailure,
    beginRoomChatIntent,
    createRoomChatDeliveryState,
    updateRoomChatDraft,
  } = await loadDelivery();
  const pending = beginRoomChatIntent(
    updateRoomChatDraft(createRoomChatDeliveryState(context), "Нельзя вернуть после revoke"),
    {
      clientEventSequence: 13,
      timestampEpochMs: 7_000,
      createClientMessageId: () => "08b5a20b-5639-45d3-9855-a4316174be27",
    },
  );
  const revoked = applyRoomChatFailure(pending, {
    httpStatus: 403,
    code: "ROOM_ACCESS_DENIED",
    clientMessageId: pending.intent?.clientMessageId ?? "",
    contextGeneration: 0,
  });

  assert.equal(revoked.contextGeneration, 1);
  assert.equal(revoked.status, "idle");
  assert.equal(revoked.draft, "");
  assert.equal(revoked.intent, null);
  assert.deepEqual(revoked.messages, []);
  assert.strictEqual(
    applyRoomChatAck(revoked, ack(pending.intent?.clientMessageId ?? "", "late-revoked-message"), 0),
    revoked,
  );
});
