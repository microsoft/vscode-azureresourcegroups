import { createServer } from 'node:http';
import { createTicket, listTickets } from './db.ts';

const server = createServer(async (request, response) => {
    if (request.url === '/api/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
    }
    if (request.url === '/api/tickets' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(await listTickets()));
        return;
    }
    if (request.url === '/api/tickets' && request.method === 'POST') {
        const created = await createTicket('Untitled ticket');
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify(created));
        return;
    }
    response.writeHead(404).end();
});

server.listen(Number(process.env.PORT ?? 7071));
