import type { ImportSourceInput } from "./ingestion.js";
import type { PersonaContext } from "./persona.js";

export type HostAuthorizationStatus = "active" | "revoked";

export interface HostAuthorization {
  id: string;
  userId: string;
  personaId: string;
  relationshipId: string;
  hostId: string;
  allowedEventKinds: string[];
  status: HostAuthorizationStatus;
  expiresAt: string | null;
  authorizedAt: string;
  revokedAt: string | null;
}

export interface AuthorizeHostInput {
  userId: string;
  personaId: string;
  hostId: string;
  allowedEventKinds: string[];
  expiresAt?: string;
}

export interface HostAuthorizationGrant {
  authorization: HostAuthorization;
  grant: string;
}

export interface HostAuthorizationMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
}

export interface HostEventEnvelope<Payload = unknown> {
  id: string;
  kind: string;
  occurredAt?: string;
  payload: Payload;
}

export interface HostEventAdapterInput<Payload = unknown> {
  event: HostEventEnvelope<Payload>;
  personaContext: PersonaContext;
}

export interface HostEventAdapter<Payload = unknown> {
  readonly hostId: string;
  readonly version: string;
  toSource(
    input: HostEventAdapterInput<Payload>,
  ): ImportSourceInput | Promise<ImportSourceInput>;
}

export interface CaptureAuthorizedHostEventInput<Payload = unknown> {
  authorizationId: string;
  grant: string;
  personaId: string;
  event: HostEventEnvelope<Payload>;
}

export interface HostEventReceipt {
  id: string;
  authorizationId: string;
  externalEventId: string;
  eventKind: string;
  hostId: string;
  hostVersion: string;
  personaId: string;
  relationshipId: string;
  payloadHash: string;
  sourceId: string;
  candidateIds: string[];
  capturedAt: string;
}

export interface HostEventCaptureResult {
  receipt: HostEventReceipt;
  createdCandidateCount: number;
  reused: boolean;
}
