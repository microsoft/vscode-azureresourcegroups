// API response types and error codes

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'STORAGE_ERROR';

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface TaskListResponse {
  tasks: import('./entities').Task[];
  total: number;
}
