/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { readPrDiff, scoped } = require('./diff-reader.cjs');

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const repository = 'microsoft/vscode-azureresourcegroups';
const filename = 'resources/agents/azure-debug-generate/references/generate.md';
const otherScoped = [
    'resources/agents/azure-debug-generate/references/project-types/functions.md',
    'resources/agents/azure-debug-generate/references/runtimes/node.md',
    'resources/agents/azure-debug-generate/references/emulators/azurite.md',
];
const patch = `@@ -0,0 +1,500 @@\n${Array.from({ length: 500 }, (_, i) =>
    `+${i} ${'review 🌊'.repeat(7)}`).join('\n')}`;
const headContent = patch.split('\n').slice(1).map(line => line.slice(1)).join('\n');
const sha256 = text => createHash('sha256').update(text).digest('hex');

function fixture() {
    const files = Array.from({ length: 61 }, (_, i) => ({
        filename: i === 0 ? filename : otherScoped[i - 2] ??
            `other/${String(i).padStart(3, '0')}-${'x'.repeat(85)}.md`,
        status: 'added',
        additions: i === 0 ? 500 : 1,
        deletions: 0,
        changes: i === 0 ? 500 : 1,
        ...(i === 0 ? { patch } : i >= 2 && i <= 4 ? { patch: '@@ -0,0 +1 @@\n+smoke' } : {}),
    }));
    const pull = {
        state: 'open', changed_files: files.length,
        base: { sha: base, repo: { id: 1, full_name: repository } },
        head: { sha: head, repo: { id: 1 } },
    };
    return {
        repository, pr: 1892, before: pull, after: pull,
        compare: { merge_base_commit: { sha: base }, files: structuredClone(files) },
        pages: [files],
        headFiles: [filename, ...otherScoped].map(path => ({
            filename: path, content: path === filename ? headContent : 'smoke',
        })),
    };
}

const env = { TARGET_REPOSITORY: repository, TARGET_PR: '1892' };

test('reconstructs bounded UTF-8 patch chunks and complete paginated metadata', async () => {
    const snapshot = fixture();
    let cursor = 0;
    const listed = [];
    let listingSha256;
    let complete;
    do {
        const result = await readPrDiff({ mode: 'files', cursor, baseSha: base, headSha: head }, { env, snapshot });
        assert.equal(result.baseSha, base);
        assert.equal(result.headSha, head);
        assert.equal(result.changedFiles, 61);
        assert.equal(result.listingSha256, listingSha256 ?? result.listingSha256);
        listingSha256 = result.listingSha256;
        assert.ok(result.nextCursor > cursor);
        assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] })) <= 7000);
        listed.push(...result.files);
        cursor = result.nextCursor;
        complete = result.complete;
    } while (!complete);
    assert.equal(cursor, 61);
    assert.equal(new Set(listed.map(file => file.filename)).size, 61);
    assert.ok(scoped(listed[0].filename));
    assert.ok(!scoped(listed[1].filename));
    assert.deepEqual(listed.filter(file => scoped(file.filename)).map(file => file.filename), [filename, ...otherScoped]);
    for (const path of otherScoped) {
        const result = await readPrDiff({ mode: 'diff', filename: path, baseSha: base, headSha: head }, { env, snapshot });
        assert.equal(result.chunk, '@@ -0,0 +1 @@\n+smoke');
        assert.equal(result.complete, true);
        const headResult = await readPrDiff({ mode: 'head', filename: path, baseSha: base, headSha: head }, { env, snapshot });
        assert.equal(headResult.chunk, 'smoke');
        assert.equal(headResult.complete, true);
    }

    cursor = 0;
    const chunks = [];
    do {
        const result = await readPrDiff({ mode: 'diff', filename, cursor, baseSha: base, headSha: head }, { env, snapshot });
        assert.equal(result.offset, cursor);
        assert.equal(result.totalBytes, Buffer.byteLength(patch));
        assert.equal(result.sha256, sha256(patch));
        assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] })) <= 7000);
        assert.ok(result.nextCursor > cursor);
        chunks.push(result.chunk);
        cursor = result.nextCursor;
        complete = result.complete;
    } while (!complete);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(''), patch);
    assert.equal(cursor, Buffer.byteLength(patch));

    cursor = 0;
    const headChunks = [];
    do {
        const result = await readPrDiff({ mode: 'head', filename, cursor, baseSha: base, headSha: head }, { env, snapshot });
        assert.equal(result.offset, cursor);
        assert.equal(result.totalBytes, Buffer.byteLength(headContent));
        assert.equal(result.sha256, sha256(headContent));
        assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] })) <= 7000);
        headChunks.push(result.chunk);
        cursor = result.nextCursor;
        complete = result.complete;
        if (!complete) {
            assert.ok(result.nextCursor > result.offset);
        }
    } while (!complete);
    assert.ok(headChunks.length > 1);
    assert.equal(headChunks.join(''), headContent);
});

test('rejects partial listings, moved PRs, changed comparisons and missing patches', async () => {
    const invalid = [
        [snapshot => { snapshot.pages[0].pop(); }, /pagination|count/],
        [snapshot => { snapshot.after.head.sha = base; }, /closed, moved/],
        [snapshot => { snapshot.compare.files[0].additions++; }, /comparison differs/],
        [snapshot => { delete snapshot.pages[0][0].patch; }, /patch differs/],
        [snapshot => { snapshot.pages[0][0].patch = patch.slice(0, patch.lastIndexOf('\n')); snapshot.compare.files[0].patch = snapshot.pages[0][0].patch; }, /Truncated|inconsistent/],
        [snapshot => { snapshot.before.changed_files = 3001; }, /3,000-file/],
        [snapshot => { snapshot.headFiles.pop(); }, /head-file snapshot/],
        [snapshot => { snapshot.headFiles[1].filename = filename; }, /head-file snapshot/],
        [snapshot => { snapshot.before = null; }, /closed, moved/],
        [snapshot => { snapshot.after = null; }, /closed, moved/],
        [snapshot => { snapshot.compare = null; }, /merge-base comparison/],
        [snapshot => { snapshot.compare.files[0] = null; }, /comparison differs/],
        [snapshot => { snapshot.pages[0][0] = null; }, /file metadata/],
        [snapshot => { snapshot.headFiles[0] = null; }, /head-file snapshot/],
    ];
    for (const [mutate, expected] of invalid) {
        const snapshot = fixture();
        snapshot.after = structuredClone(snapshot.after);
        mutate(snapshot);
        await assert.rejects(readPrDiff({ mode: 'diff', filename, baseSha: base, headSha: head }, { env, snapshot }), expected);
    }
    await assert.rejects(
        readPrDiff({ mode: 'files' }, { env: { ...env, GH_TOKEN: 'never-pass-a-token' }, snapshot: fixture() }),
        /must not receive GitHub credentials/,
    );
    await assert.rejects(
        readPrDiff({ mode: 'files' }, { env: { ...env, EXPECTED_HEAD_SHA: base, EXPECTED_BASE_SHA: base }, snapshot: fixture() }),
        /closed, moved/,
    );
    for (const snapshot of [42, [], { error: {} }]) {
        await assert.rejects(
            readPrDiff({ mode: 'files' }, { env, snapshot }),
            /Invalid diff snapshot/,
        );
    }
});

test('rejects oversized response metadata rather than returning a non-advancing chunk', async () => {
    const snapshot = fixture();
    const longFilename = `${filename}${'🌊'.repeat(2000)}`;
    snapshot.pages[0][0].filename = longFilename;
    snapshot.compare.files[0].filename = longFilename;
    snapshot.headFiles[0].filename = longFilename;
    await assert.rejects(
        readPrDiff({ mode: 'diff', filename: longFilename, baseSha: base, headSha: head }, { env, snapshot }),
        /Chunk exceeds the response limit/,
    );
});

test('stdio MCP exposes only the reader and returns bounded JSON-RPC results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cor-review-reader-'));
    const snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(fixture()));
    const child = spawn(process.execPath, [require.resolve('./diff-reader.cjs')], {
        env: { PATH: process.env.PATH, ...env, SNAPSHOT_PATH: snapshotPath },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const messages = [
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_pr_diff', arguments: { mode: 'files' } } },
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_pr_diff', arguments: { mode: 'diff', filename, baseSha: base, headSha: head } } },
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_pr_diff', arguments: { mode: 'head', filename, baseSha: base, headSha: head } } },
    ];
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stdin.end(messages.map(message => JSON.stringify(message)).join('\n') + '\n');
    const [code] = await once(child, 'close');
    rmSync(dir, { recursive: true });
    assert.equal(code, 0);
    const responses = output.trim().split('\n').map(JSON.parse);
    assert.equal(responses[0].result.serverInfo.name, 'cor-review-diffs');
    assert.deepEqual(responses[1].result.tools.map(tool => tool.name), ['read_pr_diff']);
    assert.equal(JSON.parse(responses[2].result.content[0].text).changedFiles, 61);
    assert.equal(JSON.parse(responses[3].result.content[0].text).totalBytes, Buffer.byteLength(patch));
    assert.equal(JSON.parse(responses[4].result.content[0].text).totalBytes, Buffer.byteLength(headContent));
});
