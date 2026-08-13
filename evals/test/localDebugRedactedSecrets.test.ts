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

const MASK = '*'.repeat(6);

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
        { name: 'api (debug)', type: 'node', request: 'launch', preLaunchTask: 'Start Emulators' },
    ],
};

const TASKS = {
    version: '2.0.0',
    tasks: [
        {
            label: 'Start Emulators',
            type: 'shell',
            command: 'docker compose up -d --wait postgres',
        },
    ],
};

async function createWorkspace(composeContent: string, envContent?: string): Promise<string> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-redaction-'));
    await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), JSON.stringify(LAUNCH, undefined, 2));
    await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify(TASKS, undefined, 2));
    await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), '{}');
    await fs.writeFile(
        path.join(workspace, '.vscode', 'extensions.json'),
        JSON.stringify({ recommendations: ['ms-azuretools.vscode-azurefunctions'] }, undefined, 2),
    );
    await fs.writeFile(path.join(workspace, 'docker-compose.yml'), composeContent);
    if (envContent !== undefined) {
        await fs.writeFile(path.join(workspace, '.env'), envContent);
    }
    return workspace;
}

function codes(issues: { code: string }[]): string[] {
    return issues.map(issue => issue.code);
}

void test('a redaction mask in a generated compose file is rejected', async () => {
    // Reproduces the observed production defect: a masked credential URL reaches docker-compose.yml,
    // where YAML reads the leading asterisk as an alias indicator and refuses to parse the file.
    const workspace = await createWorkspace([
        'services:',
        '  db-migrate:',
        '    image: node:22-slim',
        '    environment:',
        `      DATABASE_URL: ${MASK}postgres:5432/supportdesk`,
    ].join('\n'));

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(codes(result.issues).includes('redactedSecretPlaceholder'), `expected redactedSecretPlaceholder, got ${codes(result.issues).join(', ')}`);
    const issue = result.issues.find(value => value.code === 'redactedSecretPlaceholder');
    assert.match(issue!.message, /docker-compose\.yml line 5/);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a compose file interpolating undeclared variables is rejected', async () => {
    // ${VAR} resolves from .env, never from a service's own environment block. Without .env the
    // value silently becomes an empty string and the database starts with blank credentials.
    const workspace = await createWorkspace([
        'services:',
        '  postgres:',
        '    image: postgres:16',
        '    environment:',
        '      POSTGRES_USER: ${POSTGRES_USER}',
        '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
    ].join('\n'));

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(codes(result.issues).includes('missingComposeEnvValues'), `expected missingComposeEnvValues, got ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('interpolation backed by a .env file is accepted', async () => {
    const workspace = await createWorkspace(
        [
            'services:',
            '  postgres:',
            '    image: postgres:16',
            '    environment:',
            '      POSTGRES_USER: ${POSTGRES_USER}',
            '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
        ].join('\n'),
        'POSTGRES_USER=postgres\nPOSTGRES_PASSWORD=postgres\n',
    );

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingComposeEnvValues'), `unexpected interpolation issue: ${codes(result.issues).join(', ')}`);
    assert.ok(!codes(result.issues).includes('redactedSecretPlaceholder'));
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('glob patterns are not mistaken for redaction masks', async () => {
    const workspace = await createWorkspace([
        'services:',
        '  api:',
        '    image: node:22-slim',
        '    environment:',
        '      WATCH_GLOB: "**/*.ts"',
        '      CORS: "*"',
    ].join('\n'));

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('redactedSecretPlaceholder'), `unexpected mask issue: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});

void test('a variable with a default value does not require a .env entry', async () => {
    const workspace = await createWorkspace([
        'services:',
        '  postgres:',
        '    image: postgres:16',
        '    environment:',
        '      POSTGRES_DB: ${POSTGRES_DB:-localdev}',
    ].join('\n'));

    const result = await validateLocalDebugArtifacts(workspace, PLAN);

    assert.ok(!codes(result.issues).includes('missingComposeEnvValues'), `unexpected interpolation issue: ${codes(result.issues).join(', ')}`);
    await fs.rm(workspace, { recursive: true, force: true });
});
