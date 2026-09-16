export interface Task {
  id: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'done';
  dueDate?: string;
}

export interface CreateTaskRequest {
  title: string;
  dueDate?: string;
}

export interface HealthResponse {
  status: string;
}
