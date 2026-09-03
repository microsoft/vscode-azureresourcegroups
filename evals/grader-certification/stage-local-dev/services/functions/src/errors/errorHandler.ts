// errors/errorHandler.ts
import { HttpResponseInit, InvocationContext } from '@azure/functions';
import { AppError } from './AppError';
import { ZodError } from 'zod';

export function handleError(error: unknown, context: InvocationContext): HttpResponseInit {
  // Known application errors
  if (error instanceof AppError) {
    context.warn(`${error.code}: ${error.message}`);
    return {
      status: error.statusCode,
      jsonBody: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
    };
  }

  // Zod validation errors → map to ValidationError shape
  if (error instanceof ZodError) {
    const details = error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    context.warn('Validation failed', details);
    return {
      status: 422,
      jsonBody: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details,
        },
      },
    };
  }

  // Unknown errors → 500
  const err = error instanceof Error ? error : new Error(String(error));
  context.error('Unhandled error', err);
  
  return {
    status: 500,
    jsonBody: {
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production'
          ? 'An internal error occurred'
          : err.message,
        details: null,
      },
    },
  };
}
