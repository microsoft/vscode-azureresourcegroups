export type TicketStatus = 'open' | 'closed';

export interface TicketRecord {
    id: string;
    title: string;
    status: TicketStatus;
}
