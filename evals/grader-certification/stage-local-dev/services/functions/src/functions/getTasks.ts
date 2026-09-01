// functions/getTasks.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import type { Task } from '../../../shared/types/entities';

app.http('getTasks', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { database } = getServices();

      const limit = Number(request.query.get('limit')) || 50;
      const offset = Number(request.query.get('offset')) || 0;

      const [tasks, total] = await Promise.all([
        database.findAll<Task>('task', {
          limit,
          offset,
          orderBy: 'dueDate',
          orderDirection: 'asc',
        }),
        database.count('task'),
      ]);

      return {
        status: 200,
        jsonBody: {
          tasks,
          total,
        },
      };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
