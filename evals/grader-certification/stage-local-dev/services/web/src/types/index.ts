/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Local type definitions for the task tracker

export type TaskStatus = 'Not started' | 'In progress' | 'Done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string; // ISO 8601 date string
  attachmentName?: string;
  attachmentSize?: number;
  attachmentUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title: string;
  status: TaskStatus;
  dueDate: string;
  attachment?: File;
}

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}
