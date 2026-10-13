import type {
  HostAuthorization,
  HostEventReceipt,
} from "../domain/host-event.js";

export interface CreateHostAuthorizationRecordInput {
  id: string;
  userId: string;
  personaId: string;
  relationshipId: string;
  hostId: string;
  grantHash: string;
  allowedEventKinds: string[];
  expiresAt: string | null;
}

export interface HostAuthorizationCredential {
  authorization: HostAuthorization;
  grantHash: string;
}

export interface RecordHostEventInput {
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
}

export interface HostEventRepository {
  createAuthorization(
    input: CreateHostAuthorizationRecordInput,
  ): HostAuthorization;
  getAuthorizationCredential(id: string): HostAuthorizationCredential | null;
  listAuthorizations(userId: string, includeRevoked?: boolean): HostAuthorization[];
  revokeAuthorization(id: string): HostAuthorization;
  getEvent(
    authorizationId: string,
    externalEventId: string,
  ): HostEventReceipt | null;
  recordEvent(input: RecordHostEventInput): HostEventReceipt;
}
