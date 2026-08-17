/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-template-curly-in-string */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateLocalDebugArtifacts } from '../src/artifacts/localDebug';

const PLAN = `# Local Debug Plan

> **Status:** Auto
> **Mode:** auto

## Services

| Service | Type | Debug Configuration | Port |
|---|---|---|---|
| api | Azure Functions | api (debug) | 7071 |

## Prerequisites

| Tool / Extension | Category | Service(s) | Installed | Version | Install |
|---|---|---|---|---|---|
| Node.js | Runtime | api | Yes | 22.x | winget |
`;

const LAUNCH = {
    version: '0.2.0',
    configurations: [
        { name: 'api (debug)', type: 'node', request: 'launch', preLaunchTask: 'api: npm watch' },
    ],
};

interface WorkspaceOptions {
    tasks: unknown[];
    apiTsconfig?: Record<string, unknown>;
    sharedIsSourceOnly?: boolean;
}

async function createMonorepo(options: WorkspaceOptions): Promise<string> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-wsdeps-'));
    const write = async (relative: string, value: unknown): Promise<void> => {
        const target = path.join(workspace, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, undefined, 2));
    };

    await write('package.json', {
        name: 'root',
        private: true,
        workspaces: ['services/*'],
        scripts: { build: 'npm run build -w @app/shared && npm run build -w @app/api' },
        devDependencies: { typescript: '^5.5.0' },
    });
    await write('services/shared/package.json', options.sharedIsSourceOnly
        ? { name: '@app/shared', main: 'src/index.ts', types: 'src/index.ts' }
        : { name: '@app/shared', main: 'dist/index.js', types: 'dist/index.d.ts', scripts: { build: 'tsc' } });
    await write('services/api/package.json', {
        name: '@app/api',
        dependencies: { '@app/shared': '*' },
        scripts: { build: 'tsc', watch: 'tsc --watch' },
    });
    await write('services/shared/tsconfig.json', { compilerOptions: { outDir: 'dist' } });
    await write('services/api/tsconfig.json', options.apiTsconfig ?? { compilerOptions: { outDir: 'dist' } });

    await write('.vscode/launch.json', LAUNCH);
    await write('.vscode/tasks.json', { version: '2.0.0', tasks: options.tasks });
    await write('.vscode/settings.json', {});
    await write('.vscode/extensions.json', { recommendations: ['ms-azuretools.vscode-azurefunctions'] });
    return workspace;
}

function codes(issues: { code: string }[]): string[] {
    return issues.map(issue => issue.code);
}

const INSTALL_TASK = { label: 'Install Dependencies', type: 'shell', command: 'npm install' };

void test('a watch task that never builds its workspace dependency is rejected', async () => {
    // Reproduces the observed production defect: api depends on shared, but tasks.json never
    // builds shared, so `tsc --watch` compiles against type declarations that were never emitted.
    const workspace = await createMonorepo({
        tasks: [
            INSTALL_TASK,
            {
                label: 'api: npm watch',
                type: 'shell',
                command: 'npm run watch',
                options: { cwd: '${workspaceFolder}/services/api' },
                dependsOn: ['Install Dependencies'],
            },
        ],
    });

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        codes(result.issues).includes('missingWorkspaceDependencyBuild'),
        `expected missingWorkspaceDependencyBuild, got ${codes(result.issues).join(', ')}`,
    );
    const issue = result.issues.find(value => value.code === 'missingWorkspaceDependencyBuild');
    assert.match(issue!.message, /@app\/shared/);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a dependency build task reachable through dependsOn satisfies the contract', async () => {
    const workspace = await createMonorepo({
        tasks: [
            INSTALL_TASK,
            {
                label: 'shared: npm build',
                type: 'shell',
                command: 'npm run build',
                options: { cwd: '${workspaceFolder}/services/shared' },
                dependsOn: ['Install Dependencies'],
            },
            {
                label: 'api: npm watch',
                type: 'shell',
                command: 'npm run watch',
                options: { cwd: '${workspaceFolder}/services/api' },
                dependsOn: ['shared: npm build'],
            },
        ],
    });

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        !codes(result.issues).includes('missingWorkspaceDependencyBuild'),
        `unexpected issue: ${JSON.stringify(result.issues, undefined, 2)}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('an explicit --workspace build satisfies the contract', async () => {
    const workspace = await createMonorepo({
        tasks: [
            INSTALL_TASK,
            {
                label: 'build shared',
                type: 'shell',
                command: 'npm run build -w @app/shared',
                dependsOn: ['Install Dependencies'],
            },
            {
                label: 'api: npm watch',
                type: 'shell',
                command: 'npm run watch',
                options: { cwd: '${workspaceFolder}/services/api' },
                dependsOn: ['build shared'],
            },
        ],
    });

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        !codes(result.issues).includes('missingWorkspaceDependencyBuild'),
        `unexpected issue: ${JSON.stringify(result.issues, undefined, 2)}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('TypeScript project references satisfy the contract without a separate task', async () => {
    // `tsc -b` builds referenced projects automatically, so no explicit task ordering is required.
    const workspace = await createMonorepo({
        apiTsconfig: {
            compilerOptions: { outDir: 'dist', composite: true },
            references: [{ path: '../shared' }],
        },
        tasks: [
            INSTALL_TASK,
            {
                label: 'api: npm watch',
                type: 'shell',
                command: 'npm run watch',
                options: { cwd: '${workspaceFolder}/services/api' },
                dependsOn: ['Install Dependencies'],
            },
        ],
    });

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        !codes(result.issues).includes('missingWorkspaceDependencyBuild'),
        `unexpected issue: ${JSON.stringify(result.issues, undefined, 2)}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a source-only workspace dependency needs no build step', async () => {
    // When the dependency is consumed straight from source there is no compiled output to miss.
    const workspace = await createMonorepo({
        sharedIsSourceOnly: true,
        tasks: [
            INSTALL_TASK,
            {
                label: 'api: npm watch',
                type: 'shell',
                command: 'npm run watch',
                options: { cwd: '${workspaceFolder}/services/api' },
                dependsOn: ['Install Dependencies'],
            },
        ],
    });

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        !codes(result.issues).includes('missingWorkspaceDependencyBuild'),
        `unexpected issue: ${JSON.stringify(result.issues, undefined, 2)}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a root aggregate build that covers the dependency satisfies the contract', async () => {
    const workspace = await createMonorepo({
        tasks: [
            INSTALL_TASK,
            {
                label: 'build all',
                type: 'shell',
                command: 'npm run build',
                dependsOn: ['Install Dependencies'],
            },
            {
                label: 'api: npm watch',
                type: 'shell',
                command: 'npm run watch',
                options: { cwd: '${workspaceFolder}/services/api' },
                dependsOn: ['build all'],
            },
        ],
    });

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        !codes(result.issues).includes('missingWorkspaceDependencyBuild'),
        `unexpected issue: ${JSON.stringify(result.issues, undefined, 2)}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});
