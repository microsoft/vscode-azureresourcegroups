/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Agent instruction folders are copied to `.github/agents/` wholesale, but an agent only opens the
 * files its instructions link to. A reference nothing links to is dead weight: guidance written
 * there can never change generated output, and a fix that lands in one looks applied but is not.
 *
 * This was observed for real — a Fluent UI vitest rule was added to `testing.md`, which no agent
 * references, and the very next run reproduced the defect.
 */
const AGENTS_ROOT = path.resolve(__dirname, '..', '..', 'resources', 'agents');

async function listMarkdownFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return listMarkdownFiles(full);
        }
        return entry.name.endsWith('.md') ? [full] : [];
    }));
    return files.flat();
}

/** Entry points are reached by the extension directly rather than by a link from another file. */
function isEntryPoint(file: string): boolean {
    const base = path.basename(file);
    return base.endsWith('.agent.md') || base === 'instructions.md' || base === 'requirements.md' || base === 'plan.md';
}

/**
 * Known unreferenced files, kept out of the failure list so this guard keeps catching *new* orphans.
 * Each needs an owner decision rather than a silent link, so they are named here instead of hidden.
 */
const KNOWN_UNREFERENCED = new Map<string, string>([
    // Teaches seeding patterns, but azure-project-integrate hard-forbids seed data
    // ("NEVER create seed data"). Linking it would contradict that rule; it likely wants deleting.
    [path.join('shared-references', 'seed-data.md'), 'contradicts the integrate agent’s no-seed-data rule'],
    // 20KB of test guidance no step reads: the scaffold Step-to-Reference Mapping says
    // "Skip: All other reference files", and no step owns test authoring.
    [path.join('azure-project-scaffold', 'references', 'testing.md'), 'no scaffold step owns test authoring'],
]);

/** `project-types/{type}.md` is resolved at runtime, so its members are referenced by template. */
function isTemplatedReference(relative: string, corpus: string): boolean {
    const directory = path.dirname(relative);
    return directory !== '.' && corpus.includes(`${directory.split(path.sep).pop()}/{type}.md`);
}

void test('every agent reference file is linked by at least one instruction', async () => {
    const files = await listMarkdownFiles(AGENTS_ROOT);
    const corpus = (await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).join('\n');
    const orphans = files.filter(file => {
        if (isEntryPoint(file)) {
            return false;
        }
        const relative = path.relative(AGENTS_ROOT, file);
        if (KNOWN_UNREFERENCED.has(relative) || isTemplatedReference(relative, corpus)) {
            return false;
        }
        const base = path.basename(file);
        return !new RegExp(`\\]\\([^)]*${base.replace(/\./gu, '\\.')}\\)`, 'u').test(corpus);
    }).map(file => path.relative(AGENTS_ROOT, file));

    assert.deepEqual(
        orphans,
        [],
        'These reference files are never linked, so no agent will read them. Guidance added to them '
        + 'cannot change generated output. Link them from the owning instructions (including the '
        + `Step-to-Reference Mapping) or delete them:\n  ${orphans.join('\n  ')}`,
    );
});

void test('the known-unreferenced list stays accurate', async () => {
    // If one of these is later linked, drop it from the list so the guard keeps its meaning.
    const files = await listMarkdownFiles(AGENTS_ROOT);
    const corpus = (await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).join('\n');
    for (const [relative] of KNOWN_UNREFERENCED) {
        const base = path.basename(relative);
        assert.ok(
            await fs.stat(path.join(AGENTS_ROOT, relative)).then(() => true, () => false),
            `${relative} no longer exists; remove it from KNOWN_UNREFERENCED.`,
        );
        assert.ok(
            !new RegExp(`\\]\\([^)]*${base.replace(/\./gu, '\\.')}\\)`, 'u').test(corpus),
            `${relative} is now linked; remove it from KNOWN_UNREFERENCED.`,
        );
    }
});

void test('the Fluent UI vitest rule lives in a file the frontend step actually reads', async () => {
    // Step 1 says "Skip: All other reference files", so the rule only takes effect in these three.
    const instructions = await fs.readFile(
        path.join(AGENTS_ROOT, 'azure-project-scaffold', 'instructions.md'), 'utf8');
    const stepOne = instructions.split('\n').find(line => line.includes('**Step 1** (Frontend)'));
    assert.ok(stepOne, 'Step 1 row missing from the Step-to-Reference Mapping.');

    const quality = await fs.readFile(
        path.join(AGENTS_ROOT, 'azure-project-scaffold', 'references', 'frontend-quality-bar.md'), 'utf8');
    assert.ok(stepOne.includes('frontend-quality-bar.md'), 'Step 1 no longer reads the quality bar.');
    assert.match(quality, /tabster/u);
    assert.match(quality, /server:\s*\{\s*\n\s*deps:/u);
    // The anchored-regex trap is the part that silently wasted repair attempts.
    assert.match(quality, /anchored at string start/u);
});
