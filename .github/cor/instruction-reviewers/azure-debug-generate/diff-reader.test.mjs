/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const directory = new URL('./', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('fixtures/pr-1892.json', directory), 'utf8'));
const { readPrDiff } = createRequire(import.meta.url)('./diff-reader.cjs');
const repository = 'microsoft/vscode-azureresourcegroups';
const base = '5a564544ee12d00fc276effdc2f26c611e85a754';
const head = '90e65bd6af6f0abe86794bb61455fc1ceb371e9b';
const filename = 'resources/agents/azure-debug-generate/references/generate.md';
const digest = value => createHash('sha256').update(value).digest('hex');
const envelopeSize = value => Buffer.byteLength(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(value) }],
}));

function reader(files = fixture.files, { changedFiles = files.length, compareFiles = files, stale = false } = {}) {
    const pages = [];
    let pullReads = 0;
    const request = async url => {
        const { pathname, searchParams } = new URL(url);
        let data;
        if (pathname.endsWith('/pulls/1892')) {
            data = {
                state: 'open', changed_files: changedFiles,
                base: { sha: base, repo: { id: 42, full_name: repository } },
                head: { sha: stale && ++pullReads > 1 ? 'f'.repeat(40) : head, repo: { id: 42 } },
            };
        } else if (pathname.includes('/compare/')) {
            data = { merge_base_commit: { sha: base }, files: compareFiles };
        } else if (pathname.endsWith('/pulls/1892/files')) {
            const page = Number(searchParams.get('page'));
            pages.push(page);
            data = files.slice((page - 1) * 100, page * 100);
        } else {
            throw new Error(`Unexpected API request: ${pathname}`);
        }
        return { ok: true, json: async () => data };
    };
    const env = {
        GH_TOKEN: 'read-only-test-token', TARGET_REPOSITORY: repository, TARGET_PR: '1892',
        EXPECTED_BASE_SHA: base, EXPECTED_HEAD_SHA: head,
    };
    return { read: input => readPrDiff(input, { fetch: request, env }), pages };
}

async function listAll(read) {
    const files = [];
    let cursor = 0;
    let listingSha256;
    let changedFiles;
    let responses = 0;
    while (true) {
        const result = await read({ mode: 'files', cursor });
        assert.ok(envelopeSize(result) <= 7000);
        assert.equal(result.baseSha, base);
        assert.equal(result.headSha, head);
        if (listingSha256) {
            assert.equal(result.listingSha256, listingSha256);
            assert.equal(result.changedFiles, changedFiles);
        }
        listingSha256 = result.listingSha256;
        changedFiles = result.changedFiles;
        assert.ok(result.nextCursor > cursor || result.complete && cursor === changedFiles);
        assert.ok(result.files.every(file => !('patch' in file)));
        files.push(...result.files);
        cursor = result.nextCursor;
        responses++;
        if (result.complete) {
            break;
        }
    }
    assert.equal(cursor, changedFiles);
    assert.equal(files.length, changedFiles);
    assert.equal(new Set(files.map(file => file.filename)).size, changedFiles);
    assert.equal(listingSha256, digest(JSON.stringify(files)));
    return { files, responses };
}

test('compiled workflow mounts only the bounded stdio reader, not an HTTP script server', () => {
    const lock = readFileSync(new URL('../../../workflows/cor-debug-generate-review.lock.yml', directory), 'utf8');
    assert.match(lock, /"cor-review-diffs": \{\s+"type": "stdio"/);
    assert.match(lock, /"mounts": \[\s+"\$\{RUNNER_TEMP\}\/gh-aw\/cor-review-diffs:\/cor-review-diffs:ro"/);
    assert.ok(!lock.includes('GH_AW_MCP_SCRIPTS_API_KEY'));
    assert.ok(!lock.includes('Start MCP Scripts Server'));
});

test('lists all 61 PR files and reconstructs the actual 27 KB patch in bounded chunks', async () => {
    const { read, pages } = reader();
    const { files, responses } = await listAll(read);
    assert.equal(files.length, 61);
    assert.ok(responses > 1);
    assert.deepEqual([...new Set(pages)], [1]);
    assert.equal(files.filter(file => file.filename === 'resources/agents/azure-debug-generate.agent.md' ||
        file.filename.startsWith('resources/agents/azure-debug-generate/')).length, 21);

    const patch = fixture.files.find(file => file.filename === filename).patch;
    assert.ok(Buffer.byteLength(patch) > 20000);
    let assembled = '';
    let cursor = 0;
    let chunks = 0;
    while (true) {
        const result = await read({ mode: 'diff', filename, cursor });
        assert.ok(envelopeSize(result) <= 7000);
        assert.equal(result.offset, cursor);
        assert.equal(result.totalBytes, Buffer.byteLength(patch));
        assert.equal(result.sha256, digest(patch));
        assert.ok(result.nextCursor > cursor);
        assert.equal(result.nextCursor - cursor, Buffer.byteLength(result.chunk));
        assembled += result.chunk;
        cursor = result.nextCursor;
        chunks++;
        if (result.complete) {
            break;
        }
    }
    assert.ok(chunks > 1);
    assert.equal(cursor, Buffer.byteLength(patch));
    assert.equal(assembled, patch);
});

test('checks all API and response pages before accepting a 131-file listing', async () => {
    const files = Array.from({ length: 131 }, (_, index) => ({
        filename: `docs/file-${index}.md`, status: 'added',
        additions: 1, deletions: 0, changes: 1, patch: '@@ -0,0 +1 @@\n+text',
    }));
    const { read, pages } = reader(files);
    const listing = await listAll(read);
    assert.equal(listing.files.length, 131);
    assert.ok(listing.responses > 2);
    assert.deepEqual([...new Set(pages)], [1, 2]);
    await assert.rejects(reader(files, { changedFiles: 132 }).read({ mode: 'files' }), /pagination/);
});

test('rejects stale commits, mismatched comparison, and shortened scoped patches', async () => {
    await assert.rejects(reader(fixture.files, { stale: true }).read({ mode: 'files' }), /moved/);
    await assert.rejects(reader(fixture.files, { compareFiles: fixture.files.slice(1) }).read({ mode: 'files' }), /comparison/);
    const truncated = fixture.files.map(file => file.filename === filename ?
        { ...file, patch: file.patch.slice(0, -100) } : file);
    await assert.rejects(reader(truncated, { compareFiles: fixture.files }).read({ mode: 'diff', filename }), /patch/);
    const incompleteHunk = fixture.files.map(file => file.filename === filename ?
        { ...file, patch: file.patch.slice(0, 80) } : file);
    await assert.rejects(reader(incompleteHunk).read({ mode: 'diff', filename }), /patch|hunk/);
    await assert.rejects(reader().read({ mode: 'diff', filename: '../other' }), /outside/);
});

test('covers scoped renames and deletions, but rejects patches beyond the compare limit', async () => {
    const moved = { filename: 'elsewhere/renamed.md', previous_filename: filename, status: 'renamed',
        additions: 0, deletions: 0, changes: 0 };
    const deleted = { filename: 'resources/agents/azure-debug-generate/deleted.md', status: 'removed',
        additions: 0, deletions: 1, changes: 1, patch: '@@ -1 +0,0 @@\n-old' };
    const { read } = reader([moved, deleted]);
    const renamed = await read({ mode: 'diff', filename: moved.filename });
    assert.equal(renamed.previousFilename, filename);
    assert.equal(renamed.chunk, '');
    assert.equal(renamed.complete, true);
    const removed = await read({ mode: 'diff', filename: deleted.filename });
    assert.equal(removed.chunk, deleted.patch);

    const files = Array.from({ length: 301 }, (_, index) => ({
        filename: index === 300 ? filename : `docs/file-${index}.md`,
        status: 'added', additions: 1, deletions: 0, changes: 1, patch: '@@ -0,0 +1 @@\n+text',
    }));
    const limited = reader(files, { compareFiles: files.slice(0, 300) });
    assert.equal((await listAll(limited.read)).files.length, 301);
    await assert.rejects(limited.read({ mode: 'diff', filename }), /immutable comparison limit/);
});

test('a live PR listing consumes every bounded page and verifies its unique-file digest', {
    skip: !process.env.COR_REVIEW_LIVE_PR,
}, async () => {
    const env = {
        GH_TOKEN: process.env.GH_TOKEN,
        TARGET_REPOSITORY: repository,
        TARGET_PR: process.env.COR_REVIEW_LIVE_PR,
    };
    const read = input => readPrDiff(input, { env });
    const files = [];
    let cursor = 0;
    let baseSha;
    let headSha;
    let listingSha256;
    while (true) {
        const result = await read({ mode: 'files', cursor, baseSha, headSha });
        assert.ok(envelopeSize(result) <= 7000);
        baseSha ??= result.baseSha;
        headSha ??= result.headSha;
        listingSha256 ??= result.listingSha256;
        assert.equal(result.baseSha, baseSha);
        assert.equal(result.headSha, headSha);
        assert.equal(result.listingSha256, listingSha256);
        assert.ok(result.nextCursor > cursor || result.complete && cursor === result.changedFiles);
        files.push(...result.files);
        cursor = result.nextCursor;
        if (result.complete) {
            assert.equal(files.length, result.changedFiles);
            break;
        }
    }
    assert.equal(new Set(files.map(file => file.filename)).size, files.length);
    assert.equal(listingSha256, digest(JSON.stringify(files)));
});
