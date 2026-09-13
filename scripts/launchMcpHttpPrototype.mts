/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'azure-mcp-http-prototype-'));
await chmod(root, 0o700);
const extensionTest = process.argv.includes('--verify-extension-host');
await Promise.all(['user-data', 'extensions', 'fixture'].map(name => mkdir(join(root, name), { mode: 0o700 })));
console.log(`Isolated prototype profile: ${root}`);
console.log('Trust only the empty fixture. Run Azure: Enable MCP HTTP Prototype and approve the window.');
console.log('Do not enable CoR autopilot, global tool auto-approval, or click Next Steps workflow actions.');
const extraArgs: string[] = [];
const launchEnvironment: NodeJS.ProcessEnv = { ...process.env, ['AZURE_RESOURCES_MCP_HTTP_PROTOTYPE']: '1' };
if (extensionTest) {
    launchEnvironment['VSCODE_RUNNING_TESTS'] = '1';
    launchEnvironment['AZURE_RESOURCES_MCP_HTTP_PROTOTYPE_RESULT'] = join(root, 'host-check-result.json');
    console.log('Account-independent Development-mode SDK check. Trust the fixture and approve the listener through normal UI. No Copilot model is used.');
}
const bootstrap = join(root, 'bootstrap');
await mkdir(bootstrap, { mode: 0o700 });
await writeFile(join(bootstrap, 'package.json'), JSON.stringify({
    name: 'azure-http-prototype-bootstrap',
    publisher: 'azure-prototype-test',
    version: '0.0.0',
    engines: { vscode: '^1.106.0' },
    activationEvents: ['onStartupFinished'],
    main: './extension.cjs',
}), { mode: 0o600 });
await build({
    entryPoints: ['scripts/mcpHttpPrototypeBootstrap.ts'],
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: join(bootstrap, 'extension.cjs'),
    define: { 'process.env.AZURE_RESOURCES_MCP_HTTP_PROTOTYPE_VERIFY_HOST': extensionTest ? "'1'" : "'0'" },
});
extraArgs.push(`--extensionDevelopmentPath=${bootstrap}`);
const args = [
    '--new-window', '--wait', '--skip-welcome', '--skip-release-notes', '--disable-telemetry',
    `--user-data-dir=${join(root, 'user-data')}`,
    `--extensions-dir=${join(root, 'extensions')}`,
    `--extensionDevelopmentPath=${resolve('.')}`,
    ...extraArgs,
    join(root, 'fixture'),
];
if (process.argv.includes('--prepare-only')) {
    console.log('Prepared only. VS Code was not launched.');
} else {
    const child = spawn(process.env.VSCODE_EXECUTABLE ?? 'code', args, {
        env: launchEnvironment,
        stdio: 'inherit',
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => child.kill(signal));
    }
    try {
        process.exitCode = await new Promise<number>((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', code => resolve(code ?? 1));
        });
        if (extensionTest) {
            const result: unknown = JSON.parse(await readFile(join(root, 'host-check-result.json'), 'utf8'));
            if (!result || typeof result !== 'object' || !('passed' in result) || result.passed !== true) {
                throw new Error('The SDK extension-host check did not pass');
            }
        }
    } catch (error) {
        console.error('Prototype launch or SDK check failed. For the SDK check, trust the empty fixture, approve the listener, and wait for PASS before closing the window.', error);
        process.exitCode = 1;
    }
}
