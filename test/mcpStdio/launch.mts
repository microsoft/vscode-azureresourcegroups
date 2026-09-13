/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { build } from 'esbuild';
import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const automated = process.argv.includes('--test');
const companion = process.argv.includes('--companion');
const directory = await mkdtemp(join(tmpdir(), 'azure-mcp-stdio-run-'));
await chmod(directory, 0o700);
const workspace = join(directory, 'workspace');
const profile = process.env.AZURE_RESOURCES_MCP_PROFILE ?? join(directory, 'profile');
const extensions = process.env.AZURE_RESOURCES_MCP_EXTENSIONS ?? join(directory, 'extensions');
await Promise.all([mkdir(join(workspace, '.azure'), { recursive: true }), ...(process.env.AZURE_RESOURCES_MCP_EXTENSIONS ? [] : [mkdir(extensions)])]);
await writeFile(join(workspace, '.azure', 'project-plan.md'), '# Disposable MCP transport test\n');
if (!process.env.AZURE_RESOURCES_MCP_PROFILE) {
    await mkdir(join(profile, 'User'), { recursive: true, mode: 0o700 });
    await chmod(profile, 0o700);
    await writeFile(join(profile, 'User', 'settings.json'), JSON.stringify({
        'telemetry.telemetryLevel': 'off',
        'security.workspace.trust.enabled': true,
        'window.restoreWindows': 'none',
        'workbench.startupEditor': 'none',
        'extensions.autoUpdate': false,
    }));
} else {
    const info = await lstat(profile);
    if (!isAbsolute(profile) || !info.isDirectory() || info.isSymbolicLink() ||
        info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) {
        throw new Error('An explicitly reused prototype profile must be an absolute owner-only directory.');
    }
}
if (automated) {
    await build({
        entryPoints: ['test/mcpStdio/extension.ts'],
        outfile: 'dist/mcpStdio.extension.test.cjs',
        bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'],
    });
}
if (companion) {
    const bootstrap = join(directory, 'bootstrap');
    await mkdir(bootstrap);
    await writeFile(join(bootstrap, 'package.json'), JSON.stringify({
        name: 'mcp-stdio-prototype-bootstrap', publisher: 'prototype', version: '0.0.1',
        engines: { vscode: '^1.106.0' }, main: './extension.cjs', activationEvents: ['onStartupFinished'],
    }));
    await build({
        entryPoints: ['test/mcpStdio/bootstrap.ts'], outfile: join(bootstrap, 'extension.cjs'),
        bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'],
    });
}
const args = [
    '--new-window', '--wait', '--skip-welcome', '--skip-release-notes',
    `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`,
    `--extensionDevelopmentPath=${resolve('.')}`,
    ...(companion ? [`--extensionDevelopmentPath=${join(directory, 'bootstrap')}`] : []),
    ...(process.env.AZURE_RESOURCES_MCP_CDP_PORT ? [`--remote-debugging-port=${process.env.AZURE_RESOURCES_MCP_CDP_PORT}`] : []),
    ...(automated ? [`--extensionTestsPath=${resolve('dist/mcpStdio.extension.test.cjs')}`] : []),
    workspace,
];
console.log(`Prototype 2 artifacts: ${directory}`);
console.log('Trust only the generated disposable workspace. Do not enable autopilot or click the deployment/debug actions.');
let executable = process.env.VSCODE_BINARY ?? 'code';
if (process.platform === 'darwin') {
    const commandPath = isAbsolute(executable) ? executable : (await promisify(execFile)('/usr/bin/which', [executable])).stdout.trim();
    const cliPath = await realpath(commandPath);
    const contents = cliPath.indexOf('/Contents/Resources/app/bin/');
    if (contents !== -1) {
        const binaryDirectory = join(cliPath.slice(0, contents), 'Contents', 'MacOS');
        const binaries = (await readdir(binaryDirectory, { withFileTypes: true })).filter(item => item.isFile());
        if (binaries.length !== 1) {
            throw new Error('Set VSCODE_BINARY to the actual application executable.');
        }
        // The CLI wait marker is released on reload. Own the application process instead.
        executable = join(binaryDirectory, binaries[0].name);
    }
}
console.log(`Prototype 2 application executable: ${executable}`);
if (process.argv.includes('--prepare-only')) {
    process.exit(0);
}
const environment = { ...process.env };
environment.AZURE_RESOURCES_MCP_ARTIFACTS = directory;
const child = spawn(executable, args, {
    stdio: 'inherit',
    env: environment,
});
console.log(`Prototype 2 launcher PID: ${child.pid}`);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
