// utils/validation.ts
import { HttpRequest } from '@azure/functions';
import { ZodSchema } from 'zod';
import { ValidationError } from '../errors/errorTypes';

export async function validateBody<T>(request: HttpRequest, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new ValidationError('Request validation failed', details);
  }
  return result.data;
}

export function validatePathParam(param: string | undefined, name: string, schema: ZodSchema): string {
  if (!param) {
    throw new ValidationError(`Missing required path parameter: ${name}`);
  }
  
  const result = schema.safeParse(param);
  if (!result.success) {
    throw new ValidationError(`Invalid ${name} format`, result.error.errors);
  }
  
  return result.data;
}
