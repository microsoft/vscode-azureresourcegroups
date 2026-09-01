// functions/createTask.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import { validateBody } from '../utils/validation';
import { CreateTaskSchema } from '../../../shared/schemas/validation';
import type { Task } from '../../../shared/types/entities';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

app.http('createTask', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await validateBody(request, CreateTaskSchema);
      const { database } = getServices();

      const now = new Date().toISOString();
      const task: Task = {
        id: generateId(),
        title: body.title,
        status: body.status || 'not-started',
        dueDate: body.dueDate,
        createdAt: now,
        updatedAt: now,
      };

      const created = await database.create<Task>('task', task);

      return {
        status: 201,
        jsonBody: {
          task: created,
        },
      };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
