/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// API seam - the single swap point for mock → live integration

import type { ApiClient } from './types';
import { mockClient } from './mockClient';

export const api: ApiClient = mockClient;
export type { ApiClient } from './types';
