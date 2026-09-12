import { Pool } from 'pg';
import type { Ticket } from '@app/shared';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function listTickets(): Promise<Ticket[]> {
    const result = await pool.query<Ticket>('SELECT id, title, status FROM tickets ORDER BY id');
    return result.rows;
}

export async function createTicket(title: string): Promise<Ticket> {
    const result = await pool.query<Ticket>(
        'INSERT INTO tickets (title, status) VALUES ($1, $2) RETURNING id, title, status',
        [title, 'open'],
    );
    return result.rows[0];
}
