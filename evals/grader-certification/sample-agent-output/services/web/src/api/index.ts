import type { ApiClient } from './client';
import { mockClient } from './mockClient';

export const api: ApiClient = mockClient;
export type { ApiClient } from './client';
