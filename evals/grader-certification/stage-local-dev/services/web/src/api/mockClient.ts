// Mock API client implementation

import type { ApiClient } from './types';
import type { Task, CreateTaskRequest, HealthResponse } from '../types';
import { mockTasks } from '../mocks/data';
import { getPreviewState } from './previewState';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let tasks = [...mockTasks];

export const mockClient: ApiClient = {
  async getHealth(): Promise<HealthResponse> {
    const state = getPreviewState();
    
    if (state === 'loading') {
      await delay(10000); // Never resolves in practical terms
      throw new Error('Timeout');
    }
    
    if (state === 'error') {
      throw new Error('Health check failed');
    }
    
    await delay(200);
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  },

  async getTasks(): Promise<Task[]> {
    const state = getPreviewState();
    
    if (state === 'loading') {
      await delay(10000);
      return [];
    }
    
    if (state === 'error') {
      throw new Error('Failed to fetch tasks');
    }
    
    if (state === 'empty') {
      await delay(300);
      return [];
    }
    
    await delay(400);
    return [...tasks];
  },

  async getTask(id: string): Promise<Task> {
    const state = getPreviewState();
    
    if (state === 'loading') {
      await delay(10000);
      throw new Error('Timeout');
    }
    
    if (state === 'error') {
      throw new Error('Failed to fetch task');
    }
    
    await delay(300);
    const task = tasks.find(t => t.id === id);
    
    if (!task) {
      throw new Error('Task not found');
    }
    
    return { ...task };
  },

  async createTask(request: CreateTaskRequest): Promise<Task> {
    const state = getPreviewState();
    
    if (state === 'loading') {
      await delay(10000);
      throw new Error('Timeout');
    }
    
    if (state === 'error') {
      throw new Error('Failed to create task');
    }
    
    await delay(500);
    
    const newTask: Task = {
      id: String(Date.now()),
      title: request.title,
      status: request.status,
      dueDate: request.dueDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Simulate file upload if attachment provided
    if (request.attachment) {
      newTask.attachmentName = request.attachment.name;
      newTask.attachmentSize = request.attachment.size;
      newTask.attachmentUrl = 'https://images.unsplash.com/photo-1554224311-beee0c58a3c6?w=400&h=300&fit=crop';
    }
    
    tasks.unshift(newTask);
    return newTask;
  },
};
