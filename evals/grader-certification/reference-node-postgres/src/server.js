'use strict';

// A reference app that persists through a real PostgreSQL server, and the reason it
// exists is narrow: `reference-node-fullstack` proves the CRUD gate can observe a
// round-trip, but it persists to a JSON file. It therefore cannot tell us anything
// about the path that had never once been exercised — a project whose package.json
// declares `pg`, which is the shape every Azure-stack stimulus actually produces.
//
// Until the emulators shipped, that path always ended in `datastoreRequiresContainer`.
// Proving it now needs an app that genuinely fails when the database is absent, so
// this file deliberately does no fallback: no in-memory array, no "if the connection
// fails, serve []". A silent fallback would make this fixture pass with PostgreSQL
// stopped, which is precisely the false green the gate exists to catch.

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const publicRoot = path.join(__dirname, '..', 'public');

// The default matches what the phase preamble provisions (role `taskuser`, database
// `tasktracker`), which in turn matches the docker-compose defaults the scaffold agent
// emits. DATABASE_URL still wins, because the credentials belong to the app rather
// than to the harness.
const connectionString = process.env.DATABASE_URL
    ?? 'postgresql://taskuser:taskpassword@127.0.0.1:5432/tasktracker';

const pool = new Pool({ connectionString });

let ready;
function ensureSchema() {
    // Once per process, not once per request: a CREATE TABLE on the hot path would hide
    // a connection failure behind a retry and make the first POST look slow rather than
    // broken.
    ready ??= pool.query(
        'CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, name TEXT NOT NULL)',
    );
    return ready;
}

function send(response, status, contentType, body) {
    response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(body);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            body += chunk;
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

function createServer() {
    return http.createServer(async (request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost');
        try {
            if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
                // Bounded on purpose. An unbounded readiness probe against a datastore is
                // the exact product defect this suite filed as #1756: the request hangs
                // instead of reporting the dependency as down.
                await Promise.race([
                    pool.query('SELECT 1'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                ]);
                send(response, 200, 'application/json', JSON.stringify({ status: 'ok' }));
                return;
            }
            if (request.method === 'GET' && requestUrl.pathname === '/api/items') {
                await ensureSchema();
                const { rows } = await pool.query('SELECT id, name FROM items ORDER BY id');
                send(response, 200, 'application/json', JSON.stringify(rows));
                return;
            }
            if (request.method === 'POST' && requestUrl.pathname === '/api/items') {
                await ensureSchema();
                const payload = JSON.parse(await readBody(request));
                if (typeof payload.name !== 'string' || !payload.name.trim()) {
                    send(response, 400, 'application/json', JSON.stringify({ error: 'name is required' }));
                    return;
                }
                const { rows } = await pool.query(
                    'INSERT INTO items (name) VALUES ($1) RETURNING id, name',
                    [payload.name.trim()],
                );
                send(response, 201, 'application/json', JSON.stringify(rows[0]));
                return;
            }
        } catch (error) {
            // 503, not 500. The database being unreachable is a dependency failure, and
            // reporting it as a server fault is what makes "the emulator never started"
            // look like "the app is broken" in a gate result.
            send(response, 503, 'application/json', JSON.stringify({ error: String(error && error.message) }));
            return;
        }

        const asset = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
        if (!['index.html', 'app.js', 'styles.css'].includes(asset)) {
            send(response, 404, 'text/plain; charset=utf-8', 'Not found');
            return;
        }
        const contentTypes = {
            'index.html': 'text/html; charset=utf-8',
            'app.js': 'text/javascript; charset=utf-8',
            'styles.css': 'text/css; charset=utf-8',
        };
        send(response, 200, contentTypes[asset], await fs.readFile(path.join(publicRoot, asset)));
    });
}

if (require.main === module) {
    const server = createServer();
    server.listen(Number(process.env.PORT ?? 7071), '0.0.0.0');
    process.on('SIGTERM', () => server.close());
}

module.exports = { createServer };
