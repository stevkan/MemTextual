import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  AuthorizeHostInput,
  AssertHostCaptureAuthorizedInput,
  CaptureAuthorizedHostEventInput,
  HostAuthorization,
  HostAuthorizationGrant,
  HostAuthorizationMutationContext,
  HostEventAdapter,
  HostEventCaptureResult,
  HostEventReceipt,
} from "../domain/host-event.js";
import type { ImportSourceInput } from "../domain/ingestion.js";
import type { HostEventRepository } from "../repositories/host-event-repository.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";
import { normalizeTimestamp } from "../temporal/temporal-relevance.js";
import type { AmbientMemoryService } from "./ambient-memory-service.js";

function requiredIdentifier(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !/^[a-z0-9][a-z0-9._:@/-]*$/iu.test(normalized)
  ) {
    throw new Error(
      `${label} must be a stable machine-readable identifier up to ${maximum} characters.`,
    );
  }
  return normalized;
}

function normalizeEventKinds(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("A host authorization requires at least one event kind.");
  }
  return [
    ...new Set(
      values.map((value) => requiredIdentifier(value, "An event kind", 200)),
    ),
  ].sort();
}

function requireExplicitUserAction(
  context: HostAuthorizationMutationContext,
): void {
  if (context.actor !== "user" || context.explicitUserAction !== true) {
    throw new Error("Host authorization changes require an explicit user action.");
  }
}

function grantHash(grant: string): string {
  if (!/^mthg_[A-Za-z0-9_-]{43}$/u.test(grant)) {
    throw new Error("Host capture authorization was rejected.");
  }
  return createHash("sha256").update(grant, "utf8").digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function payloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export class HostAuthorizationService {
  public constructor(
    private readonly repository: HostEventRepository,
    private readonly personas: PersonaRepository,
  ) {}

  public authorize(
    input: AuthorizeHostInput,
    context: HostAuthorizationMutationContext = {},
  ): HostAuthorizationGrant {
    requireExplicitUserAction(context);
    const persona = this.personas.getPersonaContext(input.personaId);
    if (persona === null || persona.persona.userId !== input.userId) {
      throw new Error("The host authorization persona does not belong to the user.");
    }
    const hostId = requiredIdentifier(input.hostId, "A host ID", 200);
    const allowedEventKinds = normalizeEventKinds(input.allowedEventKinds);
    const expiresAt =
      input.expiresAt === undefined
        ? null
        : normalizeTimestamp(input.expiresAt, "expiresAt");
    if (expiresAt !== null && expiresAt <= new Date().toISOString()) {
      throw new Error("A host authorization expiration must be in the future.");
    }
    const grant = `mthg_${randomBytes(32).toString("base64url")}`;
    const authorization = this.repository.createAuthorization({
      id: randomUUID(),
      userId: input.userId,
      personaId: persona.persona.id,
      relationshipId: persona.relationship.id,
      hostId,
      grantHash: grantHash(grant),
      allowedEventKinds,
      expiresAt,
    });
    return { authorization, grant };
  }

  public revoke(
    id: string,
    context: HostAuthorizationMutationContext = {},
  ): HostAuthorization {
    requireExplicitUserAction(context);
    return this.repository.revokeAuthorization(id);
  }

  public list(userId: string, includeRevoked = false): HostAuthorization[] {
    return this.repository.listAuthorizations(userId, includeRevoked);
  }
}

export class AuthorizedHostEventCaptureService<Payload = unknown> {
  private readonly hostId: string;
  private readonly hostVersion: string;

  public constructor(
    private readonly repository: HostEventRepository,
    private readonly personas: PersonaRepository,
    private readonly ambient: AmbientMemoryService,
    private readonly adapter: HostEventAdapter<Payload>,
  ) {
    this.hostId = requiredIdentifier(adapter.hostId, "A host adapter ID", 200);
    this.hostVersion = requiredIdentifier(
      adapter.version,
      "A host adapter version",
      200,
    );
  }

  public get identity(): { adapterId: string; adapterVersion: string } {
    return { adapterId: this.hostId, adapterVersion: this.hostVersion };
  }

  public assertAuthorized(input: AssertHostCaptureAuthorizedInput): HostAuthorization {
    const authorizationId = requiredIdentifier(
      input.authorizationId,
      "A host authorization ID",
      200,
    );
    const eventKind = requiredIdentifier(input.eventKind, "A host event kind", 200);
    const credential = this.repository.getAuthorizationCredential(authorizationId);
    const suppliedGrantHash = grantHash(input.grant);
    if (
      credential === null ||
      !hashesEqual(credential.grantHash, suppliedGrantHash) ||
      credential.authorization.status !== "active" ||
      credential.authorization.hostId !== this.hostId ||
      credential.authorization.personaId !== input.personaId ||
      !credential.authorization.allowedEventKinds.includes(eventKind) ||
      (credential.authorization.expiresAt !== null &&
        credential.authorization.expiresAt < new Date().toISOString())
    ) {
      throw new Error("Host capture authorization was rejected.");
    }
    const persona = this.personas.getPersonaContext(input.personaId);
    if (
      persona === null ||
      persona.relationship.id !== credential.authorization.relationshipId
    ) {
      throw new Error("Host capture authorization was rejected.");
    }
    return credential.authorization;
  }

  public async capture(
    input: CaptureAuthorizedHostEventInput<Payload>,
  ): Promise<HostEventCaptureResult> {
    const authorizationId = requiredIdentifier(
      input.authorizationId,
      "A host authorization ID",
      200,
    );
    const externalEventId = requiredIdentifier(
      input.event.id,
      "A host event ID",
      500,
    );
    const eventKind = requiredIdentifier(
      input.event.kind,
      "A host event kind",
      200,
    );
    const authorization = this.assertAuthorized({
      authorizationId,
      grant: input.grant,
      personaId: input.personaId,
      eventKind,
    });
    const persona = this.personas.getPersonaContext(input.personaId);
    if (
      persona === null ||
      persona.relationship.id !== authorization.relationshipId
    ) {
      throw new Error("Host capture authorization was rejected.");
    }
    const source = await this.adapter.toSource({
      event: input.event,
      personaContext: persona,
    });
    const normalizedSource = this.normalizeSource(
      source,
      authorizationId,
      externalEventId,
      eventKind,
      input.event.occurredAt,
    );
    const hash = payloadHash({
      hostId: this.hostId,
      hostVersion: this.hostVersion,
      personaId: input.personaId,
      event: {
        id: externalEventId,
        kind: eventKind,
        occurredAt: input.event.occurredAt ?? null,
      },
      source: normalizedSource,
    });
    const existing = this.repository.getEvent(authorizationId, externalEventId);
    if (existing !== null) {
      this.requireMatchingReplay(existing, hash);
      return { receipt: existing, createdCandidateCount: 0, reused: true };
    }

    const captured = await this.ambient.captureInteraction({
      personaId: input.personaId,
      source: normalizedSource,
    });
    const record = {
      id: randomUUID(),
      authorizationId,
      externalEventId,
      eventKind,
      hostId: this.hostId,
      hostVersion: this.hostVersion,
      personaId: persona.persona.id,
      relationshipId: persona.relationship.id,
      payloadHash: hash,
      sourceId: captured.source.id,
      candidateIds: [...new Set(captured.candidates.map(({ id }) => id))],
    };
    try {
      const receipt = this.repository.recordEvent(record);
      return {
        receipt,
        createdCandidateCount: captured.createdCandidateCount,
        reused: false,
      };
    } catch (error) {
      const raced = this.repository.getEvent(authorizationId, externalEventId);
      if (raced === null) {
        throw error;
      }
      this.requireMatchingReplay(raced, hash);
      return { receipt: raced, createdCandidateCount: 0, reused: true };
    }
  }

  private normalizeSource(
    source: ImportSourceInput,
    authorizationId: string,
    externalEventId: string,
    eventKind: string,
    occurredAt: string | undefined,
  ): ImportSourceInput {
    if (typeof source !== "object" || source === null) {
      throw new Error("A host event adapter must return a source import.");
    }
    if (!Array.isArray(source.records) || source.records.length === 0) {
      throw new Error("A host event adapter must return at least one source record.");
    }
    const capturedAt =
      occurredAt === undefined
        ? source.capturedAt
        : normalizeTimestamp(occurredAt, "Host event occurredAt");
    return {
      kind: source.kind,
      title: source.title,
      ...(source.originUri === undefined ? {} : { originUri: source.originUri }),
      externalId: `continuity-host:${authorizationId}:${externalEventId}`,
      ...(capturedAt === undefined ? {} : { capturedAt }),
      metadata: {
        ...(source.metadata ?? {}),
        hostCapture: {
          authorizationId,
          hostId: this.hostId,
          hostVersion: this.hostVersion,
          externalEventId,
          eventKind,
        },
      },
      records: source.records,
    };
  }

  private requireMatchingReplay(receipt: HostEventReceipt, hash: string): void {
    if (receipt.payloadHash !== hash) {
      throw new Error(
        "A host event ID cannot be reused with different content or adapter output.",
      );
    }
  }
}
