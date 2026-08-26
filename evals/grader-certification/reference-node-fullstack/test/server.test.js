'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../src/server');

test('health and persisted item workflow succeeds', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-grader-reference-'));
    const server = createServer({ dataFile: path.join(directory, 'items.json') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    const created = await fetch(`${baseUrl}/api/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Certified project' }),
    });
    assert.equal(created.status, 201);
    const items = await fetch(`${baseUrl}/api/items`);
    assert.deepEqual(await items.json(), [{ id: 1, name: 'Certified project' }]);
});
