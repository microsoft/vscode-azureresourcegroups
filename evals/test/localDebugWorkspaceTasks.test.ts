/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { validateLocalDebugArtifacts } from '../src/artifacts/localDebug';

const plan = [
    '# Azure Debug Plan',
    '',
    '> **Status:** Implemented',
    '> **Execution Mode:** Auto',
    '',
    '---',
    '',
    '## Prerequisites',
    '',
    '| Tool / Extension | Category | Service(s) | Installed | Version | Install |',
    '| --- | --- | --- | --- | --- | --- |',
    '| Node.js | Runtime | Support Ticket API | ❓ | — | https://nodejs.org/ |',
    '',
    '## Debug Configurations',
    '',
    '| Generate | Debug Config Name | Service Root | Project Type | Runtime |',
    '| --- | --- | --- | --- | --- |',
    '| [x] | Support Ticket API (debug) | services/support-ticket-api | functions | node-ts |',
    '',
].join('\n');

interface WorkspaceOptions {
    rootDeclaresWorkspaces?: boolean;
    apiDeclaresRimraf?: boolean;
    rootInstallTask?: boolean;
}

/**
 * Mirrors the generated `support-desk` monorepo from the crud-react-functions-postgres run whose
 * `support-ticket-api: npm clean` task failed with `sh: 1: rimraf: not found` (exit code 127).
 */
async function createWorkspace(options: WorkspaceOptions): Promise<string> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-workspace-'));
    const api = path.join(workspace, 'services', 'support-ticket-api');
    await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
    await fs.mkdir(api, { recursive: true });

    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
        name: 'support-desk',
        private: true,
        ...(options.rootDeclaresWorkspaces === false ? {} : { workspaces: ['services/support-ticket-api'] }),
        devDependencies: { rimraf: '^6.0.1' },
    }));
    await fs.writeFile(path.join(api, 'package.json'), JSON.stringify({
        name: '@support/api',
        private: true,
        scripts: { clean: 'rimraf dist', watch: 'tsc --watch' },
        devDependencies: {
            typescript: '^5.9.2',
            ...(options.apiDeclaresRimraf ? { rimraf: '^6.0.1' } : {}),
        },
    }));

    const runOptions = { instanceLimit: 1, instancePolicy: 'silent' };
    // eslint-disable-next-line no-template-curly-in-string -- VS Code task variable, not a template literal.
    const serviceCwd = { cwd: '${workspaceFolder}/services/support-ticket-api' };
    const installLabel = options.rootInstallTask ? 'Install Dependencies' : 'support-ticket-api: npm install';
    await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            {
                label: installLabel,
                command: 'npm install',
                problemMatcher: [],
                runOptions,
                ...(options.rootInstallTask ? {} : { options: serviceCwd }),
            },
            {
                label: 'support-ticket-api: npm clean',
                command: 'npm run clean',
                dependsOn: [installLabel],
                options: serviceCwd,
                problemMatcher: [],
                runOptions,
            },
            {
                label: 'support-ticket-api: npm watch',
                command: 'npm run watch',
                dependsOn: ['support-ticket-api: npm clean'],
                options: serviceCwd,
                isBackground: true,
                problemMatcher: '$tsc-watch',
                runOptions,
            },
        ],
    }));
    await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), JSON.stringify({
        version: '0.2.0',
        configurations: [{
            name: 'Support Ticket API (debug)',
            type: 'node',
            request: 'attach',
            port: 9229,
            preLaunchTask: 'support-ticket-api: npm watch',
        }],
    }));
    await fs.writeFile(path.join(workspace, '.vscode', 'extensions.json'), JSON.stringify({
        recommendations: ['ms-azuretools.vscode-azurefunctions'],
    }));
    await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({}));
    return workspace;
}

async function validate(options: WorkspaceOptions): Promise<string[]> {
    const workspace = await createWorkspace(options);
    try {
        const result = await validateLocalDebugArtifacts(workspace, plan);
        return result.issues.map(issue => issue.code);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
}

describe('npm workspaces local-debug task contracts', () => {
    test('rejects a member script whose tool is declared only at the workspace root', async () => {
        const codes = await validate({ rootInstallTask: true });
        assert.ok(
            codes.includes('undeclaredWorkspaceToolDependency'),
            `expected undeclaredWorkspaceToolDependency, received ${JSON.stringify(codes)}`,
        );
    });

    test('rejects a member-scoped install task in a workspaces monorepo', async () => {
        const codes = await validate({ apiDeclaresRimraf: true });
        assert.ok(
            codes.includes('missingWorkspaceRootInstallTask'),
            `expected missingWorkspaceRootInstallTask, received ${JSON.stringify(codes)}`,
        );
    });

    test('reports both defects for the exact shape that failed in production', async () => {
        const codes = await validate({});
        assert.ok(codes.includes('undeclaredWorkspaceToolDependency'));
        assert.ok(codes.includes('missingWorkspaceRootInstallTask'));
    });

    test('accepts a root install task plus a locally declared tool', async () => {
        const codes = await validate({ apiDeclaresRimraf: true, rootInstallTask: true });
        assert.ok(!codes.includes('undeclaredWorkspaceToolDependency'), JSON.stringify(codes));
        assert.ok(!codes.includes('missingWorkspaceRootInstallTask'), JSON.stringify(codes));
    });

    test('does not apply workspace rules to a repo without a workspaces field', async () => {
        const codes = await validate({ rootDeclaresWorkspaces: false });
        assert.ok(!codes.includes('undeclaredWorkspaceToolDependency'));
        assert.ok(!codes.includes('missingWorkspaceRootInstallTask'));
    });
});
