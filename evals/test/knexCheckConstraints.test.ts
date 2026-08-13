/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateLocalDebugArtifacts } from '../src/artifacts/localDebug';

/**
 * Run 9 died at `docker compose run --rm db-migrate` with
 * `TypeError: table.checkIn is not a function`, after build, tests, and integration had passed and
 * the repair budget was already spent. Knex defines `checkIn` (and the other constrained-value
 * helpers) only on the column builder — verified against knex 3.3.0, whose TableBuilder prototype
 * exposes just `check`. These tests pin the deterministic contract that now catches it in ms.
 */
async function withWorkspace(
    files: Record<string, string>,
    run: (workspace: string) => Promise<void>,
): Promise<void> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-knex-'));
    try {
        for (const [relative, contents] of Object.entries(files)) {
            const target = path.join(workspace, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, contents, 'utf8');
        }
        await run(workspace);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
}

async function knexIssues(migration: string): Promise<{ code: string; message: string }[]> {
    let issues: { code: string; message: string }[] = [];
    await withWorkspace({ 'services/api/migrations/20260813000000_create.ts': migration }, async workspace => {
        const result = await validateLocalDebugArtifacts(workspace, '');
        issues = result.issues.filter(issue => issue.code === 'knexTableCheckMisuse');
    });
    return issues;
}

/** The exact shape run 9 generated, reduced to the failing lines. */
const RUN_NINE_MIGRATION = `import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tickets', (table) => {
    table.string('priority', 20).notNullable();
    table.string('status', 20).notNullable().defaultTo('open');
    table.checkIn('priority', ['normal', 'high', 'urgent']);
    table.checkIn('status', ['open', 'in_progress', 'closed']);
    table.check('char_length(subject) >= 5');
  });
}
`;

void test('fires on the table-level checkIn that killed run 9', async () => {
    const issues = await knexIssues(RUN_NINE_MIGRATION);
    assert.equal(issues.length, 2, 'both misused calls should be reported');
    assert.match(issues[0].message, /checkIn/u);
    assert.match(issues[0].message, /only on the column builder/u);
    // The message must carry the runnable fix, not just the diagnosis.
    assert.match(issues[0].message, /\.notNullable\(\)\.checkIn\(/u);
    // Line numbers make the report actionable without opening the workspace.
    assert.match(issues[0].message, /:7 calls/u);
    assert.match(issues[1].message, /:8 calls/u);
});

void test('stays silent on the correct chained column form', async () => {
    const issues = await knexIssues(`import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tickets', (table) => {
    table.string('status', 20).notNullable().checkIn(['open', 'in_progress', 'closed']);
    table.integer('score').checkBetween([0, 100]);
    table.string('slug').checkRegex('^[a-z-]+$');
  });
}
`);
    assert.deepEqual(issues, [], 'chained column-builder calls are the documented correct form');
});

void test('stays silent on the table-level check predicate, which does exist', async () => {
    const issues = await knexIssues(`import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tickets', (table) => {
    table.check("status in ('open','closed')");
  });
}
`);
    assert.deepEqual(issues, []);
});

void test('covers every column-only helper, not just checkIn', async () => {
    for (const method of ['checkNotIn', 'checkPositive', 'checkNegative', 'checkBetween', 'checkLength', 'checkRegex']) {
        const issues = await knexIssues(`import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('t', (table) => {
    table.${method}('col', [1, 2]);
  });
}
`);
        assert.equal(issues.length, 1, `${method} should be caught`);
        assert.match(issues[0].message, new RegExp(method, 'u'));
    }
});

void test('ignores commented-out counter-examples', async () => {
    const issues = await knexIssues(`import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('t', (table) => {
    // table.checkIn('status', ['a']); <- wrong, kept as a note
    table.string('status').checkIn(['a']);
  });
}
`);
    assert.deepEqual(issues, [], 'a comment must not trip the contract');
});

void test('ignores migrations under node_modules', async () => {
    let issues: { code: string }[] = [];
    await withWorkspace({
        'node_modules/some-pkg/migrations/001_x.ts': RUN_NINE_MIGRATION,
    }, async workspace => {
        const result = await validateLocalDebugArtifacts(workspace, '');
        issues = result.issues.filter(issue => issue.code === 'knexTableCheckMisuse');
    });
    assert.deepEqual(issues, [], 'dependency migrations are not the generated project');
});
