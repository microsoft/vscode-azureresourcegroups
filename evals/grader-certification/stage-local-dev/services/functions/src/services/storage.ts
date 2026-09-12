// services/storage.ts
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { IStorageService } from './interfaces/IStorageService';
import { loadConfig } from './config';

export class BlobStorageService implements IStorageService {
  private blobServiceClient: BlobServiceClient;

  constructor(connectionString?: string) {
    const config = loadConfig();
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      connectionString || config.storageConnectionString
    );
  }

  private getContainerClient(container: string): ContainerClient {
    return this.blobServiceClient.getContainerClient(container);
  }

  async upload(
    container: string,
    name: string,
    data: Buffer,
    contentType?: string
  ): Promise<string> {
    const containerClient = this.getContainerClient(container);
    await containerClient.createIfNotExists({ access: 'blob' });
    
    const blockBlobClient = containerClient.getBlockBlobClient(name);
    await blockBlobClient.upload(data, data.length, {
      blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
    });
    
    return blockBlobClient.url;
  }

  async download(container: string, name: string): Promise<Buffer> {
    const containerClient = this.getContainerClient(container);
    const blobClient = containerClient.getBlobClient(name);
    const downloadResponse = await blobClient.download();
    
    if (!downloadResponse.readableStreamBody) {
      throw new Error('Failed to download blob: no stream body');
    }
    
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async list(container: string): Promise<string[]> {
    const containerClient = this.getContainerClient(container);
    const names: string[] = [];
    
    try {
      for await (const blob of containerClient.listBlobsFlat()) {
        names.push(blob.name);
      }
    } catch {
      // Container doesn't exist or is empty
      return [];
    }
    
    return names;
  }

  async delete(container: string, name: string): Promise<void> {
    const containerClient = this.getContainerClient(container);
    const blobClient = containerClient.getBlobClient(name);
    await blobClient.deleteIfExists();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.blobServiceClient.getAccountInfo();
      return true;
    } catch {
      return false;
    }
  }
}
