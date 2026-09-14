// API seam - repointed at the live client by the integrate agent.

import type { ApiClient } from './types';
import { liveClient } from './client';

export const api: ApiClient = liveClient;
export type { ApiClient } from './types';
