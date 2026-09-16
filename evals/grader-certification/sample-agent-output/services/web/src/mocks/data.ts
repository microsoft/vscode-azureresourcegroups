/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Ticket } from '../api/types';

export const tickets: Ticket[] = [
    { id: '1', title: 'Cannot sign in', status: 'open' },
    { id: '2', title: 'Billing discrepancy', status: 'closed' },
];
