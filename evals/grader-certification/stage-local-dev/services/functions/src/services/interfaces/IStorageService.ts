// services/interfaces/IStorageService.ts
export interface IStorageService {
  upload(container: string, name: string, data: Buffer, contentType?: string): Promise<string>;
  download(container: string, name: string): Promise<Buffer>;
  list(container: string): Promise<string[]>;
  delete(container: string, name: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
