import assert from "node:assert/strict";
import test from "node:test";
import {
  ContinuityConversationClientCoordinator,
  ContinuityConversationOpenRecoveryRequiredError,
  type ContinuityConversation,
  type ContinuityConversationCaptureRetryResult,
  type ContinuityConversationClientOperations,
  type ContinuityConversationReconciliationResult,
  type ContinuityConversationTurnCapture,
  type ContinuityConversationTurnResult,
  type ReconcileContinuityConversationInput,
  type ResumeContinuityConversationInput,
  type SendContinuityConversationTurnInput,
  type StartContinuityConversationInput,
} from "../src/index.js";

const conversation: ContinuityConversation = {
  id: "conversation-1",
  userId: "user-1",
  personaId: "persona-1",
  relationshipId: "relationship-1",
  authorizationId: "authorization-1",
  hostId: "host-1",
  externalConversationId: "external-conversation-1",
  behaviorProfileId: null,
  behaviorProfileRevision: null,
  createdAt: "2026-10-15T12:00:00.000Z",
};

const reconciliation: ContinuityConversationReconciliationResult = {
  conversation,
  hostTurnCount: 2,
  existingCaptureCount: 1,
  recovered: [],
};

const turnResult = Object.freeze({}) as ContinuityConversationTurnResult;
const retryResult = Object.freeze({}) as ContinuityConversationCaptureRetryResult;

class FakeConversationOperations implements ContinuityConversationClientOperations {
  readonly calls: string[] = [];
  recoverableCaptures: ContinuityConversationTurnCapture[] = [];
  reconcileFailure: Error | null = null;
  sendTurnImplementation: (
    input: SendContinuityConversationTurnInput,
  ) => Promise<ContinuityConversationTurnResult> = async () => turnResult;

  async startConversation(
    _input: StartContinuityConversationInput,
  ): Promise<ContinuityConversation> {
    this.calls.push("start");
    return conversation;
  }

  async resumeConversation(
    _input: ResumeContinuityConversationInput,
  ): Promise<ContinuityConversation> {
    this.calls.push("resume");
    return conversation;
  }

  async reconcileConversationHistory(
    _input: ReconcileContinuityConversationInput,
  ): Promise<ContinuityConversationReconciliationResult> {
    this.calls.push("reconcile");
    if (this.reconcileFailure !== null) {
      throw this.reconcileFailure;
    }
    return reconciliation;
  }

  listRecoverableCaptures(personaId: string): ContinuityConversationTurnCapture[] {
    this.calls.push(`recoverable:${personaId}`);
    return this.recoverableCaptures;
  }

  async sendTurn(
    input: SendContinuityConversationTurnInput,
  ): Promise<ContinuityConversationTurnResult> {
    this.calls.push("send");
    return this.sendTurnImplementation(input);
  }

  async retryCapture(): Promise<ContinuityConversationCaptureRetryResult> {
    this.calls.push("retry");
    return retryResult;
  }
}

const openInput: ResumeContinuityConversationInput = {
  conversationId: conversation.id,
  personaId: conversation.personaId,
  grant: "grant-1",
};

const sendInput: SendContinuityConversationTurnInput = {
  ...openInput,
  text: "Please remember this turn.",
};

test("capture retry delegates without changing conversation readiness", async () => {
  const operations = new FakeConversationOperations();
  const coordinator = new ContinuityConversationClientCoordinator(operations);
  assert.equal(
    await coordinator.retryCapture({
      captureId: "capture-1",
      personaId: conversation.personaId,
      grant: "grant-1",
    }),
    retryResult,
  );
  assert.deepEqual(operations.calls, ["retry"]);
});

test("open reconciles authoritative history before resuming and enables turns", async () => {
  const operations = new FakeConversationOperations();
  const coordinator = new ContinuityConversationClientCoordinator(operations);

  const result = await coordinator.openConversation(openInput);
  assert.deepEqual(result, { conversation, reconciliation });
  assert.deepEqual(operations.calls, [
    "reconcile",
    "recoverable:persona-1",
    "resume",
  ]);

  assert.equal(await coordinator.sendTurn(sendInput), turnResult);
});

test("open surfaces unresolved recovery for only the selected conversation", async () => {
  const operations = new FakeConversationOperations();
  const selectedCapture = createCapture("capture-1", conversation.id, "failed");
  operations.recoverableCaptures = [
    createCapture("capture-other", "conversation-other", "failed"),
    selectedCapture,
  ];
  const coordinator = new ContinuityConversationClientCoordinator(operations);

  await assert.rejects(
    coordinator.openConversation(openInput),
    (error: unknown) => {
      assert.ok(error instanceof ContinuityConversationOpenRecoveryRequiredError);
      assert.equal(error.conversationId, conversation.id);
      assert.deepEqual(error.captures, [selectedCapture]);
      return true;
    },
  );
  assert.deepEqual(operations.calls, ["reconcile", "recoverable:persona-1"]);
  await assert.rejects(
    coordinator.sendTurn(sendInput),
    /must be opened and reconciled/,
  );
});

test("reconciliation failure prevents resume and leaves the conversation closed", async () => {
  const operations = new FakeConversationOperations();
  operations.reconcileFailure = new Error("history unavailable");
  const coordinator = new ContinuityConversationClientCoordinator(operations);

  await assert.rejects(
    coordinator.openConversation(openInput),
    /history unavailable/,
  );
  assert.deepEqual(operations.calls, ["reconcile"]);
  await assert.rejects(
    coordinator.sendTurn(sendInput),
    /must be opened and reconciled/,
  );
});

test("a conversation cannot open or send twice while opening", async () => {
  const operations = new FakeConversationOperations();
  let completeReconciliation:
    | ((result: ContinuityConversationReconciliationResult) => void)
    | undefined;
  operations.reconcileConversationHistory = async () => {
    operations.calls.push("reconcile");
    return new Promise((resolve) => {
      completeReconciliation = resolve;
    });
  };
  const coordinator = new ContinuityConversationClientCoordinator(operations);

  const opening = coordinator.openConversation(openInput);
  await assert.rejects(
    coordinator.openConversation(openInput),
    /has an active operation/,
  );
  await assert.rejects(
    coordinator.sendTurn(sendInput),
    /must be opened and reconciled/,
  );
  assert.ok(completeReconciliation !== undefined);
  completeReconciliation(reconciliation);
  await opening;
  assert.equal(await coordinator.sendTurn(sendInput), turnResult);
});

test("a newly started conversation is immediately ready", async () => {
  const operations = new FakeConversationOperations();
  const coordinator = new ContinuityConversationClientCoordinator(operations);

  assert.equal(
    await coordinator.startConversation({
      personaId: conversation.personaId,
      authorizationId: conversation.authorizationId,
      grant: "grant-1",
    }),
    conversation,
  );
  assert.equal(await coordinator.sendTurn(sendInput), turnResult);
  assert.deepEqual(operations.calls, ["start", "send"]);
});

test("a failed send closes the conversation until it is reopened", async () => {
  const operations = new FakeConversationOperations();
  const coordinator = new ContinuityConversationClientCoordinator(operations);
  await coordinator.openConversation(openInput);
  operations.sendTurnImplementation = async () => {
    throw new Error("capture failed");
  };

  await assert.rejects(coordinator.sendTurn(sendInput), /capture failed/);
  await assert.rejects(
    coordinator.sendTurn(sendInput),
    /must be opened and reconciled/,
  );
});

test("only one turn can be active and leaving removes local readiness", async () => {
  const operations = new FakeConversationOperations();
  const coordinator = new ContinuityConversationClientCoordinator(operations);
  await coordinator.openConversation(openInput);
  let completeTurn: ((result: ContinuityConversationTurnResult) => void) | undefined;
  operations.sendTurnImplementation = () =>
    new Promise((resolve) => {
      completeTurn = resolve;
    });

  const activeTurn = coordinator.sendTurn(sendInput);
  await assert.rejects(coordinator.sendTurn(sendInput), /already has an active turn/);
  assert.throws(
    () => coordinator.leaveConversation(conversation.id, conversation.personaId),
    /has an active operation/,
  );
  assert.ok(completeTurn !== undefined);
  completeTurn(turnResult);
  assert.equal(await activeTurn, turnResult);

  coordinator.leaveConversation(conversation.id, conversation.personaId);
  await assert.rejects(
    coordinator.sendTurn(sendInput),
    /must be opened and reconciled/,
  );
});

function createCapture(
  id: string,
  conversationId: string,
  status: ContinuityConversationTurnCapture["status"],
): ContinuityConversationTurnCapture {
  return {
    id,
    conversationId,
    externalTurnId: `turn-${id}`,
    externalEventId: `event-${id}`,
    userText: "Please remember this.",
    assistantText: "I will remember it.",
    completedAt: "2026-10-15T12:01:00.000Z",
    contextFormatVersion: 1,
    memoryRevisionIds: [],
    status,
    attemptCount: 1,
    lastAttemptAt: "2026-10-15T12:01:01.000Z",
    failureCode: status === "failed" ? "CAPTURE_FAILED" : null,
    receiptId: null,
    capturedAt: null,
    createdAt: "2026-10-15T12:01:00.000Z",
    updatedAt: "2026-10-15T12:01:01.000Z",
  };
}
