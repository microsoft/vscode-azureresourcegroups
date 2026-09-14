// Live client - the real implementation of ApiClient, added at integrate time.

import type { ApiClient } from './types';
import type { Task, CreateTaskRequest, HealthResponse } from '../types';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

export const liveClient: ApiClient = {
  getHealth: () => request<HealthResponse>('/health'),
  getTasks: () => request<Task[]>('/tasks'),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (body: CreateTaskRequest) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
};
