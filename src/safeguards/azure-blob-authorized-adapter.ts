import { ContainerClient } from "@azure/storage-blob";
import {
  AzureCertificateCredentialProvider,
  type AzureCertificateCredentialStatus,
} from "../credentials/azure-certificate-credential.js";
import type { ReplicationDestinationAdapter } from "./replication-destination.js";
import type { AzureBlobReplicationDestinationConfiguration } from "./replication-destination-config.js";
import { createAzureBlobReplicationAdapter } from "./azure-blob-replication-destination.js";

export interface AuthorizedAzureBlobReplicationAdapter {
  adapter: ReplicationDestinationAdapter;
  credentialStatus: AzureCertificateCredentialStatus;
}

export async function createAuthorizedAzureBlobReplicationAdapter(
  configuration: AzureBlobReplicationDestinationConfiguration,
  credentialProvider: AzureCertificateCredentialProvider,
): Promise<AuthorizedAzureBlobReplicationAdapter> {
  const reference = {
    credentialId: configuration.credentialId,
    kind: "certificate" as const,
  };
  const credentialStatus = credentialProvider.inspect(reference);
  const credential = await credentialProvider.acquire(reference);
  const containerClient = new ContainerClient(
    `${configuration.accountUrl}/${configuration.containerName}`,
    credential,
  );
  return {
    adapter: createAzureBlobReplicationAdapter({
      containerClient,
      ...(configuration.prefix === undefined
        ? {}
        : { prefix: configuration.prefix }),
    }),
    credentialStatus,
  };
}
