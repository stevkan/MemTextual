import type { ContinuityIdentityBinding } from "../domain/continuity-identity.js";

export interface CreateContinuityIdentityBindingRecordInput {
  id: string;
  identityHash: string;
  issuer: string;
  userId: string;
}

export interface ContinuityIdentityBindingRepository {
  createBinding(
    input: CreateContinuityIdentityBindingRecordInput,
  ): ContinuityIdentityBinding;
  getBindingByIdentityHash(
    identityHash: string,
  ): ContinuityIdentityBinding | null;
  listBindings(
    userId: string,
    includeRevoked?: boolean,
  ): ContinuityIdentityBinding[];
  revokeBinding(id: string): ContinuityIdentityBinding;
}
