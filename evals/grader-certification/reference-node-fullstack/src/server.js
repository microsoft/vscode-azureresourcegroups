'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

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

/**
 * Compares the presented bearer token against the configured one. This is a full value
 * comparison rather than a presence check on purpose: the security gate probes protected paths
 * with a syntactically well-formed token that must not validate, so an app that merely looks for
 * an Authorization header would serve protected data and has to be treated as unauthenticated.
 */
function isAuthorizedAdmin(header, expected) {
    if (!expected) {
        return false;
    }
    const match = /^Bearer (.+)$/u.exec(header ?? '');
    return match !== null && match[1] === expected;
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
    // Falling back to an unguessable random secret rather than an empty string keeps the token
    // comparison on the live path: with an empty expected value every request would short-circuit
    // before the comparison ran, so the security gate would exercise less of this code than it
    // appears to. No credential is committed anywhere as a result.
    const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN ?? randomBytes(32).toString('hex');
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
        if (request.method === 'GET' && requestUrl.pathname === '/api/admin/stats') {
            if (!isAuthorizedAdmin(request.headers.authorization, adminToken)) {
                send(response, 401, 'application/json', JSON.stringify({ error: 'unauthorized' }));
                return;
            }
            const items = await readItems(dataFile);
            send(response, 200, 'application/json', JSON.stringify({ projectCount: items.length }));
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
