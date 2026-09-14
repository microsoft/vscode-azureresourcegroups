/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CreateTicketRequest, Ticket } from './types';

export interface ApiClient {
    listTickets(): Promise<Ticket[]>;
    getTicket(id: string): Promise<Ticket>;
    createTicket(input: CreateTicketRequest): Promise<Ticket>;
}
