import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Ticket } from '../api/types';

export function TicketsPage(): JSX.Element {
    const [tickets, setTickets] = useState<Ticket[] | undefined>(undefined);
    useEffect(() => { void api.listTickets().then(setTickets); }, []);
    if (!tickets) {
        return <p>Loading…</p>;
    }
    return <ul>{tickets.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
