// functions/openapi.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

const openapiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Task Tracker API',
    version: '1.0.0',
    description: 'Task management API with attachment support',
  },
  servers: [
    {
      url: '/api',
      description: 'API base path',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        operationId: 'getHealth',
        tags: ['system'],
        responses: {
          200: {
            description: 'Service health status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['healthy', 'degraded', 'unhealthy'],
                    },
                    services: {
                      type: 'object',
                      properties: {
                        database: {
                          type: 'object',
                          properties: {
                            healthy: { type: 'boolean' },
                            message: { type: 'string' },
                          },
                        },
                        storage: {
                          type: 'object',
                          properties: {
                            healthy: { type: 'boolean' },
                            message: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          503: {
            description: 'Service unhealthy',
          },
        },
      },
    },
    '/tasks': {
      get: {
        summary: 'List all tasks',
        operationId: 'getTasks',
        tags: ['tasks'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          200: {
            description: 'List of tasks',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tasks: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Task' },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a new task',
        operationId: 'createTask',
        tags: ['tasks'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateTaskRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Task created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    task: { $ref: '#/components/schemas/Task' },
                  },
                },
              },
            },
          },
          422: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Task: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: {
            type: 'string',
            enum: ['not-started', 'in-progress', 'done'],
          },
          dueDate: { type: 'string', format: 'date' },
          attachmentUrl: { type: 'string' },
          attachmentName: { type: 'string' },
          attachmentSize: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'title', 'status', 'dueDate', 'createdAt', 'updatedAt'],
      },
      CreateTaskRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          status: {
            type: 'string',
            enum: ['not-started', 'in-progress', 'done'],
            default: 'not-started',
          },
          dueDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
        required: ['title', 'dueDate'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object', nullable: true },
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  },
};

app.http('openapi', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'openapi',
  handler: async (_request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      jsonBody: openapiSpec,
    };
  },
});
