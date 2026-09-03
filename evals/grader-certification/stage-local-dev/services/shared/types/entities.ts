// Shared types for task tracker

export type TaskStatus = 'not-started' | 'in-progress' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  createdAt: string;
  updatedAt: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database?: { healthy: boolean; message?: string };
    storage?: { healthy: boolean; message?: string };
  };
}
