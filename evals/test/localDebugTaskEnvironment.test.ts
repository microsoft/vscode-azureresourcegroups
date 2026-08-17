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

## Emulators

| Emulator | Purpose | Container |
|---|---|---|
| PostgreSQL | Primary data store | postgres:16 |

## Prerequisites

| Tool / Extension | Category | Service(s) | Installed | Version | Install |
|---|---|---|---|---|---|
| Node.js | Runtime | api | Yes | 22.x | winget |
`;

const LAUNCH = {
    version: '0.2.0',
    configurations: [
        { name: 'api (debug)', type: 'node', request: 'launch' },
    ],
};

interface WorkspaceSpec {
    tasks: unknown[];
    env?: string;
    envExample?: string;
    rootManifest?: Record<string, unknown>;
    members?: Record<string, { manifest: Record<string, unknown>; files?: Record<string, string> }>;
    files?: Record<string, string>;
}

async function createWorkspace(spec: WorkspaceSpec): Promise<string> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-taskenv-'));
    await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), JSON.stringify(LAUNCH, undefined, 2));
    await fs.writeFile(
        path.join(workspace, '.vscode', 'tasks.json'),
        JSON.stringify({ version: '2.0.0', tasks: spec.tasks }, undefined, 2),
    );
    await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), '{}');
    await fs.writeFile(
        path.join(workspace, '.vscode', 'extensions.json'),
        JSON.stringify({ recommendations: ['ms-azuretools.vscode-azurefunctions'] }, undefined, 2),
    );
    if (spec.env !== undefined) {
        await fs.writeFile(path.join(workspace, '.env'), spec.env);
    }
    if (spec.envExample !== undefined) {
        await fs.writeFile(path.join(workspace, '.env.example'), spec.envExample);
    }
    if (spec.rootManifest) {
        await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify(spec.rootManifest, undefined, 2));
    }
    for (const [relative, content] of Object.entries(spec.files ?? {})) {
        const full = path.join(workspace, relative);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
    }
    for (const [directory, member] of Object.entries(spec.members ?? {})) {
        const base = path.join(workspace, directory);
        await fs.mkdir(base, { recursive: true });
        await fs.writeFile(path.join(base, 'package.json'), JSON.stringify(member.manifest, undefined, 2));
        for (const [relative, content] of Object.entries(member.files ?? {})) {
            const full = path.join(base, relative);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, content);
        }
    }
    return workspace;
}

function codes(issues: { code: string }[]): string[] {
    return issues.map(issue => issue.code);
}

const MIGRATE_TASK = {
    label: 'api: migrate database',
    type: 'shell',
    command: 'npm run db:migrate',
};

const KNEXFILE = [
    'module.exports = {',
    '  client: "pg",',
    '  connection: process.env.DATABASE_URL,',
    '};',
].join('\n');

/** Root + member manifests where the migrate script reaches knexfile.cjs inside the member. */
function workspacesSpec(memberScripts: Record<string, string>, memberFiles: Record<string, string>): Partial<WorkspaceSpec> {
    return {
        rootManifest: {
            name: 'root',
            private: true,
            workspaces: ['services/*'],
            scripts: { 'db:migrate': 'npm run db:migrate --workspace @app/api' },
        },
        members: {
            'services/api': {
                manifest: { name: '@app/api', scripts: memberScripts },
                files: memberFiles,
            },
        },
    };
}

void test('a task reading an undeclared environment value is rejected', async () => {
    // Reproduces the observed production defect: the migrate task runs on the host, where neither
    // local.settings.json nor a compose environment block applies, and .env omits DATABASE_URL.
    // knex receives connection: undefined and fails with "Unable to acquire a connection", which
    // reads like an unready database but is a missing variable.
    const workspace = await createWorkspace({
        tasks: [MIGRATE_TASK],
        env: 'POSTGRES_USER=postgres\nPOSTGRES_PASSWORD=postgres\nPOSTGRES_DB=localdev\n',
        envExample: 'POSTGRES_USER=postgres\nDATABASE_URL=postgresql://host/db\n',
        ...workspacesSpec(
            { 'db:migrate': 'knex --knexfile knexfile.cjs migrate:latest' },
            { 'knexfile.cjs': KNEXFILE },
        ),
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        codes(result.issues).includes('missingTaskEnvValue'),
        `expected missingTaskEnvValue, got ${codes(result.issues).join(', ')}`,
    );
    const issue = result.issues.find(value => value.code === 'missingTaskEnvValue');
    assert.match(issue!.message, /DATABASE_URL/);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a value declared in .env is accepted', async () => {
    const workspace = await createWorkspace({
        tasks: [MIGRATE_TASK],
        env: 'POSTGRES_USER=postgres\nDATABASE_URL=postgresql://host/db\n',
        envExample: 'POSTGRES_USER=postgres\nDATABASE_URL=postgresql://host/db\n',
        ...workspacesSpec(
            { 'db:migrate': 'knex --knexfile knexfile.cjs migrate:latest' },
            { 'knexfile.cjs': KNEXFILE },
        ),
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingTaskEnvValue'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a value read with a fallback is not required in .env', async () => {
    const workspace = await createWorkspace({
        tasks: [MIGRATE_TASK],
        env: 'POSTGRES_USER=postgres\n',
        envExample: 'POSTGRES_USER=postgres\nLOG_LEVEL=info\n',
        ...workspacesSpec(
            { 'db:migrate': 'node migrate.js' },
            { 'migrate.js': "const level = process.env.LOG_LEVEL ?? 'info';\n" },
        ),
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingTaskEnvValue'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a Functions host task supplies its own settings and is exempt', async () => {
    // The Functions host reads local.settings.json, so the shell environment is not the source.
    const workspace = await createWorkspace({
        tasks: [{ label: 'api: host start', type: 'shell', command: 'func host start', options: { cwd: '${workspaceFolder}/services/api' } }],
        env: 'POSTGRES_USER=postgres\n',
        envExample: 'POSTGRES_USER=postgres\nDATABASE_URL=postgresql://host/db\n',
        rootManifest: { name: 'root', private: true, workspaces: ['services/*'] },
        members: {
            'services/api': {
                manifest: { name: '@app/api', scripts: {} },
                files: { 'src/config.ts': 'export const url = process.env.DATABASE_URL!;\n' },
            },
        },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingTaskEnvValue'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a dotenv-loading command is exempt', async () => {
    const workspace = await createWorkspace({
        tasks: [MIGRATE_TASK],
        env: 'POSTGRES_USER=postgres\n',
        envExample: 'POSTGRES_USER=postgres\nDATABASE_URL=postgresql://host/db\n',
        ...workspacesSpec(
            { 'db:migrate': 'dotenv -e ../../.env -- knex --knexfile knexfile.cjs migrate:latest' },
            { 'knexfile.cjs': KNEXFILE },
        ),
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingTaskEnvValue'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a docker compose task is exempt because compose injects the environment', async () => {
    const workspace = await createWorkspace({
        tasks: [{ label: 'api: migrate database', type: 'shell', command: 'docker compose run --rm db-migrate' }],
        env: 'POSTGRES_USER=postgres\n',
        envExample: 'POSTGRES_USER=postgres\nDATABASE_URL=postgresql://host/db\n',
        ...workspacesSpec(
            { 'db:migrate': 'knex --knexfile knexfile.cjs migrate:latest' },
            { 'knexfile.cjs': KNEXFILE },
        ),
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingTaskEnvValue'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a key documented but never read is not required', async () => {
    const workspace = await createWorkspace({
        tasks: [MIGRATE_TASK],
        env: 'POSTGRES_USER=postgres\n',
        envExample: 'POSTGRES_USER=postgres\nUNUSED_SETTING=x\n',
        ...workspacesSpec(
            { 'db:migrate': 'node migrate.js' },
            { 'migrate.js': 'console.log("no env reads");\n' },
        ),
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingTaskEnvValue'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a test script in a package with no tests is rejected', async () => {
    // vitest and jest exit non-zero when they collect nothing, so this fails the workspace-wide
    // `npm test` even though no code is broken.
    const workspace = await createWorkspace({
        tasks: [{ label: 'Start Emulators', type: 'shell', command: 'docker compose up -d --wait postgres' }],
        rootManifest: { name: 'root', private: true, workspaces: ['services/*'] },
        members: {
            'services/web': {
                manifest: { name: '@app/web', scripts: { test: 'vitest run' } },
                files: { 'src/main.ts': 'export const value = 1;\n' },
            },
        },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        codes(result.issues).includes('testScriptWithoutTests'),
        `expected testScriptWithoutTests, got ${codes(result.issues).join(', ')}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a package containing tests is accepted', async () => {
    const workspace = await createWorkspace({
        tasks: [{ label: 'Start Emulators', type: 'shell', command: 'docker compose up -d --wait postgres' }],
        rootManifest: { name: 'root', private: true, workspaces: ['services/*'] },
        members: {
            'services/web': {
                manifest: { name: '@app/web', scripts: { test: 'vitest run' } },
                files: { 'src/main.test.ts': 'test("works", () => {});\n' },
            },
        },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('testScriptWithoutTests'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('an explicit passWithNoTests flag is accepted', async () => {
    const workspace = await createWorkspace({
        tasks: [{ label: 'Start Emulators', type: 'shell', command: 'docker compose up -d --wait postgres' }],
        rootManifest: { name: 'root', private: true, workspaces: ['services/*'] },
        members: {
            'services/web': {
                manifest: { name: '@app/web', scripts: { test: 'vitest run --passWithNoTests' } },
                files: { 'src/main.ts': 'export const value = 1;\n' },
            },
        },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('testScriptWithoutTests'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a single-package project with a test script and no tests is rejected', async () => {
    // The same defect outside a workspaces repo: `npm test` still exits non-zero.
    const workspace = await createWorkspace({
        tasks: [{ label: 'Start Emulators', type: 'shell', command: 'docker compose up -d --wait postgres' }],
        rootManifest: { name: '@app/api', scripts: { test: 'vitest run' } },
        files: { 'src/main.ts': 'export const value = 1;\n' },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(
        codes(result.issues).includes('testScriptWithoutTests'),
        `expected testScriptWithoutTests, got ${codes(result.issues).join(', ')}`,
    );
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a single-package project containing tests is accepted', async () => {
    const workspace = await createWorkspace({
        tasks: [{ label: 'Start Emulators', type: 'shell', command: 'docker compose up -d --wait postgres' }],
        rootManifest: { name: '@app/api', scripts: { test: 'vitest run' } },
        files: { 'src/main.test.ts': 'test("works", () => {});\n' },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('testScriptWithoutTests'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('passWithNoTests set in a vitest config file is accepted', async () => {
    const workspace = await createWorkspace({
        tasks: [{ label: 'Start Emulators', type: 'shell', command: 'docker compose up -d --wait postgres' }],
        rootManifest: { name: 'root', private: true, workspaces: ['services/*'] },
        members: {
            'services/web': {
                manifest: { name: '@app/web', scripts: { test: 'vitest run' } },
                files: {
                    'src/main.ts': 'export const value = 1;\n',
                    'vitest.config.ts': 'export default { test: { passWithNoTests: true } };\n',
                },
            },
        },
    } as WorkspaceSpec);

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('testScriptWithoutTests'), `unexpected: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});
