/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { resolveDebuggerPrerequisite } from '../src/SandboxLocalRuntimeValidator';

const execFileAsync = promisify(execFile);
const workspaceFolderVariable = '$' + '{workspaceFolder}';

function expectChecks(configuration: Parameters<typeof resolveDebuggerPrerequisite>[0]) {
    const resolved = resolveDebuggerPrerequisite(configuration);
    assert.ok(!('error' in resolved), `expected checks, received error: ${JSON.stringify(resolved)}`);
    return resolved.checks;
}

void test('a Node attach configuration verifies the inspector debug target', () => {
    const checks = expectChecks({ type: 'node', request: 'attach', port: 9229 });

    assert.equal(checks.length, 1);
    assert.match(checks[0].command, /127\.0\.0\.1:9229\/json\/list/);
    // A listening socket is not proof of an attachable target; the inspector must publish one.
    assert.match(checks[0].command, /webSocketDebuggerUrl/);
    assert.match(checks[0].name, /9229/);
});

void test('every Node debug configuration type is recognised', () => {
    for (const type of ['node', 'pwa-node', 'node-terminal', 'Node']) {
        const checks = expectChecks({ type, request: 'attach', port: 9229 });
        assert.equal(checks.length, 1, `expected a check for type ${type}`);
    }
});

void test('a Node attach configuration accepts attachSimplePort and string ports', () => {
    assert.match(expectChecks({ type: 'node', request: 'attach', attachSimplePort: 9230 })[0].command, /:9230\//);
    assert.match(expectChecks({ type: 'pwa-node', request: 'attach', port: '9231' })[0].command, /:9231\//);
});

void test('a Node attach configuration without a literal port is a task graph defect', () => {
    for (const configuration of [
        { type: 'node', request: 'attach' },
        { type: 'node', request: 'attach', port: '$' + '{command:PickProcess}' },
        { type: 'node', request: 'attach', port: 0 },
        { type: 'node', request: 'attach', port: 70000 },
    ]) {
        const resolved = resolveDebuggerPrerequisite(configuration);
        assert.ok('error' in resolved, `expected an error for ${JSON.stringify(configuration)}`);
    }
});

void test('a browser launch configuration verifies the url and the webRoot', () => {
    const checks = expectChecks({
        type: 'chrome',
        request: 'launch',
        url: 'http://localhost:5173',
        webRoot: `${workspaceFolderVariable}/services/support-web`,
    });

    assert.equal(checks.length, 2);
    assert.match(checks[0].command, /localhost:5173/);
    // webRoot decides whether source maps resolve, so a missing directory means no breakpoint binds.
    assert.match(checks[1].command, /test -d '\/workspace\/services\/support-web'/);
});

void test('a browser launch configuration skips an unresolved webRoot variable', () => {
    const checks = expectChecks({
        type: 'chrome',
        request: 'launch',
        url: 'http://localhost:5173',
        webRoot: '$' + '{webRootOverride}/client',
    });

    assert.equal(checks.length, 1, 'a variable we cannot resolve must not produce a failing check');
});

void test('a browser launch configuration without a url is a task graph defect', () => {
    assert.ok('error' in resolveDebuggerPrerequisite({ type: 'chrome', request: 'launch' }));
});

void test('unobservable configurations produce no evidence instead of a synthetic pass', () => {
    for (const configuration of [
        { type: 'node', request: 'launch', program: 'index.js' },
        { type: 'python', request: 'launch' },
        { type: 'chrome', request: 'attach' },
        {},
    ]) {
        const checks = expectChecks(configuration);
        assert.equal(checks.length, 0, `expected no checks for ${JSON.stringify(configuration)}`);
    }
});

void test('debugger checks retry so a lazily started language worker is not a failure', () => {
    const command = expectChecks({ type: 'node', request: 'attach', port: 9229 })[0].command;

    assert.match(command, /for i in \$\(seq 1 \d+\); do/);
    assert.match(command, /sleep 1;/);
    assert.match(command, /exit 1$/);
});

void test('the generated Node inspector check passes against a real inspector and fails without one', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'cor-debug-'));
    const port = 9319;
    const child = spawn(
        process.execPath,
        [`--inspect=${port}`, '-e', 'setTimeout(() => {}, 60_000)'],
        { stdio: 'ignore' },
    );
    try {
        const check = expectChecks({ type: 'node', request: 'attach', port })[0];
        await execFileAsync('bash', ['-c', check.command], { cwd: workspace, timeout: 60_000 });

        const absent = expectChecks({ type: 'node', request: 'attach', port: 9318 })[0];
        // The retry loop must still terminate in failure when nothing ever listens.
        const shortened = absent.command.replace(/seq 1 \d+/u, 'seq 1 2');
        await assert.rejects(execFileAsync('bash', ['-c', shortened], { cwd: workspace, timeout: 60_000 }));
    } finally {
        child.kill();
        await rm(workspace, { recursive: true, force: true });
    }
});

void test('a Node launch configuration verifies the inspector port declared in runtimeArgs', () => {
    // A launch configuration carries no `port`; the debug surface is declared via --inspect.
    const checks = expectChecks({
        type: 'pwa-node',
        request: 'launch',
        runtimeArgs: ['--inspect=9229'],
    });

    assert.equal(checks.length, 1);
    assert.match(checks[0].command, /127\.0\.0\.1:9229\/json\/list/);
    assert.match(checks[0].command, /webSocketDebuggerUrl/);
});

void test('inspect argument forms all resolve to the port that will be verified', () => {
    const cases: Array<[string, number]> = [
        ['--inspect', 9229],
        ['--inspect-brk', 9229],
        ['--inspect=9333', 9333],
        ['--inspect-brk=9333', 9333],
        ['--inspect=0.0.0.0:9444', 9444],
    ];
    for (const [argument, expectedPort] of cases) {
        const checks = expectChecks({ type: 'node', request: 'launch', runtimeArgs: [argument] });
        assert.equal(checks.length, 1, `expected a check for ${argument}`);
        assert.match(
            checks[0].command,
            new RegExp(`127\\.0\\.0\\.1:${expectedPort}/json/list`),
            `expected port ${expectedPort} for ${argument}`,
        );
    }
});

void test('a Node launch configuration without an inspect flag declares no debug surface to verify', () => {
    // Verifying an undeclared port would invent a requirement the project never claimed.
    assert.equal(expectChecks({ type: 'node', request: 'launch', runtimeArgs: [] }).length, 0);
    assert.equal(expectChecks({ type: 'node', request: 'launch' }).length, 0);
});
