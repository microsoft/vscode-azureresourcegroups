// services/registry.ts
import { IDatabaseService } from './interfaces/IDatabaseService';
import { IStorageService } from './interfaces/IStorageService';
import { PostgresDatabaseService } from './database';
import { BlobStorageService } from './storage';

export interface ServiceRegistry {
  database: IDatabaseService;
  storage: IStorageService;
}

let services: ServiceRegistry | null = null;

export function registerServices(registry: ServiceRegistry): void {
  services = registry;
}

export function getServices(): ServiceRegistry {
  if (!services) {
    initializeServices();
  }
  return services!;
}

export function clearServices(): void {
  services = null;
}

function initializeServices(): void {
  // Essential services — let them throw if config is invalid
  const database = new PostgresDatabaseService();
  const storage = new BlobStorageService();

  services = { database, storage };
}
