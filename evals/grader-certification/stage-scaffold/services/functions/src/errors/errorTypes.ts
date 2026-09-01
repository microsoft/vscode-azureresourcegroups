// errors/errorTypes.ts
import { AppError } from './AppError';

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} with ID '${id}' was not found`
      : `${resource} not found`;
    super(404, 'NOT_FOUND', message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, 'DATABASE_ERROR', message, details);
  }
}

export class StorageError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, 'STORAGE_ERROR', message, details);
  }
}

export class InternalError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, 'INTERNAL_ERROR', message, details);
  }
}
