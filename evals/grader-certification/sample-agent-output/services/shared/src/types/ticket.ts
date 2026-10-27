/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TicketStatus = 'open' | 'closed';

export interface TicketRecord {
    id: string;
    title: string;
    status: TicketStatus;
}
