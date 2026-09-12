'use strict';

// The Azurite half of the emulator proof, and the reason it is a separate fixture from
// reference-node-postgres is that the two failure modes are not the same one.
//
// PostgreSQL either accepts a TCP connection or does not. Azurite accepts connections
// and can still be useless: it rejects storage API versions newer than the ones it
// knows about, so a current @azure/storage-blob SDK gets a hard error from an emulator
// that is running perfectly. That is why the preamble passes --skipApiVersionCheck, and
// it is exactly the class of problem a port probe cannot see. Only a real round-trip
// through the SDK can.
//
// As with the PostgreSQL fixture, there is deliberately no fallback path: no in-memory
// array, no "if the connection fails, serve []". A fixture that degraded gracefully
// would pass with Azurite stopped, which would destroy the control that gives the
// passing case its meaning.

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BlobServiceClient } = require('@azure/storage-blob');

const publicRoot = path.join(__dirname, '..', 'public');

// `UseDevelopmentStorage=true` is the well-known Azurite shorthand: it resolves to
// 127.0.0.1:10000 with the devstoreaccount1 credentials, which is what the preamble
// starts. AZURE_STORAGE_CONNECTION_STRING still wins, because the connection string
// belongs to the app rather than to the harness.
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
    ?? process.env.AzureWebJobsStorage
    ?? 'UseDevelopmentStorage=true';

const client = BlobServiceClient.fromConnectionString(connectionString);
const container = client.getContainerClient('items');
const BLOB = 'items.json';

let ready;
function ensureContainer() {
    ready ??= container.createIfNotExists();
    return ready;
}

async function readItems() {
    const blob = container.getBlockBlobClient(BLOB);
    try {
        const buffer = await blob.downloadToBuffer();
        return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
        // Only "the blob is not there yet" is an empty list. Anything else — the emulator
        // being down, an API version rejection, a credential problem — has to propagate,
        // or this fixture would report success while storing nothing.
        if (error && (error.statusCode === 404 || error.code === 'BlobNotFound')) {
            return [];
        }
        throw error;
    }
}

async function writeItems(items) {
    const body = `${JSON.stringify(items, null, 2)}\n`;
    await container.getBlockBlobClient(BLOB).upload(body, Buffer.byteLength(body));
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
                // Bounded. `containerClient.exists()` with no timeout is the product defect
                // this suite filed as #1756: against an unreachable account the request hangs
                // instead of reporting the dependency as down.
                await Promise.race([
                    ensureContainer(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                ]);
                send(response, 200, 'application/json', JSON.stringify({ status: 'ok' }));
                return;
            }
            if (request.method === 'GET' && requestUrl.pathname === '/api/items') {
                await ensureContainer();
                send(response, 200, 'application/json', JSON.stringify(await readItems()));
                return;
            }
            if (request.method === 'POST' && requestUrl.pathname === '/api/items') {
                await ensureContainer();
                const payload = JSON.parse(await readBody(request));
                if (typeof payload.name !== 'string' || !payload.name.trim()) {
                    send(response, 400, 'application/json', JSON.stringify({ error: 'name is required' }));
                    return;
                }
                const items = await readItems();
                const item = { id: items.length + 1, name: payload.name.trim() };
                await writeItems([...items, item]);
                send(response, 201, 'application/json', JSON.stringify(item));
                return;
            }
        } catch (error) {
            // 503, not 500: the storage account being unreachable is a dependency failure,
            // and reporting it as a server fault is what makes "the emulator never started"
            // look like "the app is broken".
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
