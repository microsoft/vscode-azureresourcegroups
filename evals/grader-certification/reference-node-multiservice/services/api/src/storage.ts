import { BlobServiceClient } from '@azure/storage-blob';

const client = BlobServiceClient.fromConnectionString(
    process.env.STORAGE_CONNECTION_STRING ?? 'UseDevelopmentStorage=true',
);

export async function saveAttachment(ticketId: string, body: Buffer): Promise<void> {
    const container = client.getContainerClient('attachments');
    await container.createIfNotExists();
    await container.getBlockBlobClient(`${ticketId}.bin`).uploadData(body);
}
