import type { CreateTicketRequest, Ticket } from './types';

export interface ApiClient {
    listTickets(): Promise<Ticket[]>;
    getTicket(id: string): Promise<Ticket>;
    createTicket(input: CreateTicketRequest): Promise<Ticket>;
}
