/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] ?? 'test';
if (!['baseline', 'live', 'test'].includes(mode)) { throw new Error('Expected baseline, live, or test.'); }
const output = join(root, 'out/prototype1');
await mkdir(output, { recursive: true });

function run(command, args, env = process.env) {
    return new Promise((done, reject) => {
        const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
        const stop = () => child.kill('SIGTERM');
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        child.once('error', reject);
        child.once('exit', code => {
            process.removeListener('SIGINT', stop);
            process.removeListener('SIGTERM', stop);
            if (code === 0 || code === null) { done(); }
            else { reject(new Error(`${command} exited with ${code}`)); }
        });
        console.log(`Tracked child PID: ${child.pid}`);
    });
}

if (mode === 'test') {
    await build({
        entryPoints: ['test/prototypes/vscodeMock.cts', 'test/prototypes/directSocketProtocol.ts'],
        outdir: output, outExtension: { '.js': '.cjs' }, bundle: true,
        platform: 'node', format: 'cjs', packages: 'external', external: ['./vscodeMock.cjs'],
    });
    const preload = join(output, 'preload.cjs');
    await writeFile(preload, `
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'vscode') {
        return { url: pathToFileURL(require.resolve('./vscodeMock.cjs')).href, shortCircuit: true };
    }
    return next(specifier, context);
} });
`);
    await run(process.execPath, ['--require', preload, '-e', `require(${JSON.stringify(join(output, 'directSocketProtocol.cjs'))}).run().catch(error => { console.error(error); process.exitCode = 1; })`]);
} else {
    await run('npm', ['run', 'build']);
    const bootstrap = join(output, 'bootstrap');
    await mkdir(bootstrap, { recursive: true });
    await writeFile(join(bootstrap, 'package.json'), JSON.stringify({
        name: 'cor-direct-socket-prototype-bootstrap',
        publisher: 'cor-prototype',
        version: '0.0.0',
        engines: { vscode: '^1.106.0' },
        main: './main.cjs',
        activationEvents: ['onStartupFinished'],
        contributes: {
            commands: [{ command: 'corPrototype1.captureDiagnostics', title: 'Prototype 1: Capture diagnostics' }],
        },
    }, null, 2));
    await build({
        entryPoints: ['test/prototypes/directSocketHost.ts'], outfile: join(bootstrap, 'main.cjs'),
        bundle: true, platform: 'node', format: 'cjs', external: ['vscode'],
    });
    const data = process.env.COR_MCP_PROTOTYPE_DATA
        ? resolve(process.env.COR_MCP_PROTOTYPE_DATA) : await mkdtemp(join(tmpdir(), 'cor-p1-'));
    const profile = join(data, 'u');
    const extensions = join(data, 'e');
    const fixture = process.env.COR_MCP_PROTOTYPE_WORKSPACE ?? join(data, 'fixture');
    if (process.platform !== 'win32' && Buffer.byteLength(join(profile, '1.13-main.sock')) > 103) {
        throw new Error('COR_MCP_PROTOTYPE_DATA is too long for VS Code IPC. Choose a shorter isolated path.');
    }
    await Promise.all([mkdir(join(profile, 'User'), { recursive: true }), mkdir(extensions, { recursive: true }), mkdir(fixture, { recursive: true })]);
    await chmod(profile, 0o700);
    const settings = join(profile, 'User/settings.json');
    if (!existsSync(settings)) {
        await writeFile(settings, JSON.stringify({
            'telemetry.telemetryLevel': 'off',
            'workbench.startupEditor': 'none',
            'extensions.autoUpdate': false,
            'extensions.autoCheckUpdates': false,
            'update.mode': 'none',
            'chat.editor.preferCopilotHarness': true,
            'chat.defaultToCopilotHarness': true,
        }, null, 2), { mode: 0o600 });
    }
    console.log(`Isolated data: ${data}\nProfile: ${profile}\nFixture: ${fixture}`);
    console.log('Trust only this disposable fixture. Sign in through VS Code if needed. Do not enable autopilot.');
    const executable = process.env.COR_MCP_PROTOTYPE_CODE
        ?? (process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : 'code');
    const args = [
        '--new-window', '--wait', `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`,
        `--extensionDevelopmentPath=${root}`, `--extensionDevelopmentPath=${bootstrap}`, fixture,
    ];
    const port = process.env.COR_MCP_PROTOTYPE_CDP_PORT;
    if (port) {
        if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) { throw new Error('Invalid debug port.'); }
        args.push('--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`);
    }
    await run(executable, args, {
        ...process.env,
        COR_MCP_DIRECT_SOCKET_PROTOTYPE: mode,
        COR_MCP_PROTOTYPE_DATA: data,
    });
}
