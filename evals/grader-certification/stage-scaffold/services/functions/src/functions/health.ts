// functions/health.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { database, storage } = getServices();

      const [dbHealthy, storageHealthy] = await Promise.all([
        database.healthCheck().catch(() => false),
        storage.healthCheck().catch(() => false),
      ]);

      const allHealthy = dbHealthy && storageHealthy;
      const anyHealthy = dbHealthy || storageHealthy;

      let status: 'healthy' | 'degraded' | 'unhealthy';
      let httpCode: number;

      if (allHealthy) {
        status = 'healthy';
        httpCode = 200;
      } else if (anyHealthy) {
        status = 'degraded';
        httpCode = 200; // degraded but still functional
      } else {
        status = 'unhealthy';
        httpCode = 503;
      }

      return {
        status: httpCode,
        jsonBody: {
          status,
          services: {
            database: {
              healthy: dbHealthy,
              message: dbHealthy ? 'Connected' : 'Connection failed',
            },
            storage: {
              healthy: storageHealthy,
              message: storageHealthy ? 'Connected' : 'Connection failed',
            },
          },
        },
      };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
