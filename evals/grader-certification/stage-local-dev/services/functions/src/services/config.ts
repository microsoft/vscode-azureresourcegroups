// services/config.ts
export interface AppConfig {
  databaseUrl: string;
  storageConnectionString: string;
  nodeEnv: string;
}

const REQUIRED_VARS = ['DATABASE_URL', 'AZURE_STORAGE_CONNECTION_STRING'] as const;

export function validateEnvironment(): string[] {
  const missing: string[] = [];
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  return missing;
}

export function loadConfig(): AppConfig {
  const missing = validateEnvironment();
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n\nCopy .env.example to .env and fill in the values.`
    );
  }

  return {
    databaseUrl: process.env.DATABASE_URL!,
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
