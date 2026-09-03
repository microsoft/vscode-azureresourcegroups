import type { ApiClient } from './client';
import type { CreateTicketRequest, Ticket } from './types';
import { previewState } from './previewState';
import { tickets } from '../mocks/data';

async function respond<T>(value: T): Promise<T> {
    if (previewState === 'error') {
        throw new Error('Simulated request failure');
    }
    if (previewState === 'loading') {
        return new Promise<T>(() => { /* never resolves */ });
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    return value;
}

export const mockClient: ApiClient = {
    listTickets: () => respond(previewState === 'empty' ? [] : tickets),
    getTicket: (id: string) => respond(tickets.filter(t => t.id === id)[0] as Ticket),
    createTicket: (input: CreateTicketRequest) => respond({ id: 'new', title: input.title, status: 'open' } as Ticket),
};
