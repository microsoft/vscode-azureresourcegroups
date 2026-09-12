export interface Ticket {
    id: string;
    title: string;
    status: 'open' | 'closed';
}

export interface CreateTicketRequest {
    title: string;
}
