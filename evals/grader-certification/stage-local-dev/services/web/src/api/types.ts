/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// API Client interface - the stable seam that both mock and live clients implement

import type { Task, CreateTaskRequest, HealthResponse } from '../types';

export interface ApiClient {
  getHealth(): Promise<HealthResponse>;
  getTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task>;
  createTask(request: CreateTaskRequest): Promise<Task>;
}
