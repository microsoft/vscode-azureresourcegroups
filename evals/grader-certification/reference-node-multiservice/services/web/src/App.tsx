import { useEffect, useState } from 'react';
import type { Ticket } from '@app/shared';

export function App(): JSX.Element {
    const [tickets, setTickets] = useState<Ticket[]>([]);

    useEffect(() => {
        void fetch('/api/tickets')
            .then(response => response.json())
            .then(setTickets);
    }, []);

    return (
        <main>
            <h1>Tickets</h1>
            <table>
                <tbody>
                    {tickets.map(ticket => (
                        <tr key={ticket.id}>
                            <td>{ticket.title}</td>
                            <td>{ticket.status}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </main>
    );
}
