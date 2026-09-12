'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const publicRoot = path.join(__dirname, '..', 'public');

async function readItems(dataFile) {
    try {
        return JSON.parse(await fs.readFile(dataFile, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function writeItems(dataFile, items) {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

function send(response, status, contentType, body) {
    response.writeHead(status, {
        'content-type': contentType,
        'cache-control': 'no-store',
    });
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

function createServer(options = {}) {
    const dataFile = options.dataFile ?? path.join(__dirname, '..', 'data', 'items.json');
    return http.createServer(async (request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost');
        if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
            send(response, 200, 'application/json', JSON.stringify({ status: 'ok' }));
            return;
        }
        if (request.method === 'GET' && requestUrl.pathname === '/api/items') {
            send(response, 200, 'application/json', JSON.stringify(await readItems(dataFile)));
            return;
        }
        if (request.method === 'POST' && requestUrl.pathname === '/api/items') {
            const payload = JSON.parse(await readBody(request));
            if (typeof payload.name !== 'string' || !payload.name.trim()) {
                send(response, 400, 'application/json', JSON.stringify({ error: 'name is required' }));
                return;
            }
            const items = await readItems(dataFile);
            const item = { id: items.length + 1, name: payload.name.trim() };
            await writeItems(dataFile, [...items, item]);
            send(response, 201, 'application/json', JSON.stringify(item));
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
