export interface Ticket {
    id: string;
    title: string;
    status: 'open' | 'triaged' | 'closed';
}
