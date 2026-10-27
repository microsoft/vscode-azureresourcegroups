/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ApiClient } from './client';
import { mockClient } from './mockClient';

export const api: ApiClient = mockClient;
export type { ApiClient } from './client';
