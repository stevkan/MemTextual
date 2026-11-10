export type ContinuityIdentityBindingStatus = "active" | "revoked";

export interface ContinuityVerifiedIdentity {
  issuer: string;
  subject: string;
}

export interface ContinuityIdentityBinding {
  id: string;
  identityHash: string;
  issuer: string;
  userId: string;
  status: ContinuityIdentityBindingStatus;
  authorizedAt: string;
  revokedAt: string | null;
}

export interface ContinuityIdentityBindingMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
}
