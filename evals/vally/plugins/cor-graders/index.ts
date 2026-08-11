/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GraderRegistry } from '@microsoft/vally';
import { CorAuthoritativeGrader } from './authoritative.js';

export function registerGraders(registry: GraderRegistry): void {
    registry.register(new CorAuthoritativeGrader());
}

export { AUTHORITATIVE_SCHEMA, CorAuthoritativeGrader, CUSTOM_METRICS_SCHEMA, GATE_GROUPS } from './authoritative.js';
