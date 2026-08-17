/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'fs';

import {
    DirtySourceError,
    allowDirtyEnvironmentVariable,
    assertReproducibleSource,
    readSourceProvenance,
} from '../src/sourceProvenance';

function createRepository(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'source-provenance-'));
    const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    };
    git('init', '--quiet');
    git('config', 'user.email', 'eval@example.test');
    git('config', 'user.name', 'Eval');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(root, 'evals', 'src'), { recursive: true });
    writeFileSync(path.join(root, 'evals', 'src', 'run.ts'), 'export const value = 1;\n');
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'notes.md'), 'notes\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'initial');
    return root;
}

void test('a clean tree reports the commit it will actually run', () => {
    const root = createRepository();
    const provenance = readSourceProvenance(root);
    assert.equal(provenance.dirty, false);
    assert.deepEqual(provenance.dirtyPaths, []);
    assert.equal(assertReproducibleSource(root).commit, provenance.commit);
});

void test('an edited evaluator source file stops the run before it spends capacity', () => {
    // Regression: matrix-13-run3 recorded candidateCommit 65ffe241 while tsx recompiled four
    // commits' worth of in-flight edits, so one scenario failed with "contract is not defined"
    // and the whole bundle claimed a revision it never executed.
    const root = createRepository();
    writeFileSync(path.join(root, 'evals', 'src', 'run.ts'), 'export const value = 2;\n');

    let caught: unknown;
    try {
        assertReproducibleSource(root);
    } catch (error) {
        caught = error;
    }
    assert.ok(caught instanceof DirtySourceError);
    assert.deepEqual(caught.provenance.dirtyPaths, ['evals/src/run.ts']);
    assert.match(caught.message, /did not execute/u);
});

void test('an untracked evaluator file also counts as drift', () => {
    const root = createRepository();
    writeFileSync(path.join(root, 'evals', 'src', 'scratch-probe.ts'), 'export const scratch = 1;\n');
    assert.deepEqual(readSourceProvenance(root).dirtyPaths, ['evals/src/scratch-probe.ts']);
});

void test('edits outside the measured paths do not block a run', () => {
    // Only sources that change what the run measures should gate it; blocking on unrelated
    // files would push people toward the override and defeat the guard.
    const root = createRepository();
    writeFileSync(path.join(root, 'docs', 'notes.md'), 'updated notes\n');
    assert.equal(readSourceProvenance(root).dirty, false);
});

void test('the override is explicit and still reports the drift', () => {
    const root = createRepository();
    writeFileSync(path.join(root, 'evals', 'src', 'run.ts'), 'export const value = 3;\n');
    const previous = process.env[allowDirtyEnvironmentVariable];
    process.env[allowDirtyEnvironmentVariable] = 'true';
    try {
        const provenance = assertReproducibleSource(root);
        assert.equal(provenance.dirty, true);
        assert.deepEqual(provenance.dirtyPaths, ['evals/src/run.ts']);
    } finally {
        if (previous === undefined) {
            delete process.env[allowDirtyEnvironmentVariable];
        } else {
            process.env[allowDirtyEnvironmentVariable] = previous;
        }
    }
});
