/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { diagnoseGeneratedCode } from '../src/artifacts/localDebug';

async function createWorkspace(files: Record<string, string>): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-early-diagnosis-'));
    for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
    }
    return root;
}

/**
 * Reproduces batch run 4, which failed at the test gate with a bare `npm test` failure while
 * silently carrying a second, later-fatal knex defect. Both repairs were spent guessing at the
 * first symptom; neither defect was ever named to the agent.
 */
const RUN_4_MIGRATION = `exports.up = async function up(knex) {
    await knex.schema.createTable('tickets', (table) => {
    table.uuid('id').primary();
    table.string('status', 20).notNullable();
    table.checkIn('status', ['open', 'closed']);
});
};
`;

void test('early diagnosis reports a declared test script with no tests', async () => {
    const workspace = await createWorkspace({
        'package.json': JSON.stringify({ name: 'root', workspaces: ['web'] }),
        'web/package.json': JSON.stringify({
            name: '@support-desk/web',
            scripts: { test: 'vitest run' },
        }),
        'web/src/App.tsx': 'export const App = () => null;\n',
    });

    const issues = await diagnoseGeneratedCode(workspace);

    const issue = issues.find(value => value.code === 'testScriptWithoutTests');
    assert.ok(issue, `expected testScriptWithoutTests, received ${JSON.stringify(issues)}`);
    assert.match(issue.message, /@support-desk\/web/);
});

void test('early diagnosis surfaces a latent defect the failing gate would never have reached', async () => {
    const workspace = await createWorkspace({
        'package.json': JSON.stringify({ name: 'root', workspaces: ['web', 'api'] }),
        'web/package.json': JSON.stringify({
            name: '@support-desk/web',
            scripts: { test: 'vitest run' },
        }),
        'api/package.json': JSON.stringify({ name: '@support-desk/api' }),
        'api/migrations/20260813000000_create.cjs': RUN_4_MIGRATION,
    });

    const issues = await diagnoseGeneratedCode(workspace);

    // The point of running early is that one command failure no longer hides the rest.
    assert.ok(
        issues.some(value => value.code === 'testScriptWithoutTests'),
        'expected the failing gate to still be reported',
    );
    assert.ok(
        issues.some(value => value.code === 'knexTableCheckMisuse'),
        `expected the latent knex defect, received ${JSON.stringify(issues.map(v => v.code))}`,
    );
});

void test('early diagnosis stays silent on a workspace with no contract violations', async () => {
    const workspace = await createWorkspace({
        'package.json': JSON.stringify({ name: 'root', workspaces: ['web'] }),
        'web/package.json': JSON.stringify({
            name: '@support-desk/web',
            scripts: { test: 'vitest run' },
        }),
        'web/src/App.test.tsx': 'it("renders", () => {});\n',
    });

    assert.deepEqual(await diagnoseGeneratedCode(workspace), []);
});
