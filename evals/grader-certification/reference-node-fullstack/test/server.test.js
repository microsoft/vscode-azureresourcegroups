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

test('admin stats endpoint enforces bearer token authorization', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-grader-reference-auth-'));
    const server = createServer({
        dataFile: path.join(directory, 'items.json'),
        adminToken: 'certified-admin-token',
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const anonymous = await fetch(`${baseUrl}/api/admin/stats`);
    assert.equal(anonymous.status, 401);

    // A syntactically valid bearer token that cannot validate. This is the case that separates
    // real verification from an app that only checks whether an Authorization header is present.
    const malformed = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: 'Bearer not.a.valid.token' },
    });
    assert.equal(malformed.status, 401);

    const authorized = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: 'Bearer certified-admin-token' },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { projectCount: 0 });

    // Public paths must stay reachable, which is what proves the refusal above is selective
    // rather than an application that is simply unavailable.
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
});
