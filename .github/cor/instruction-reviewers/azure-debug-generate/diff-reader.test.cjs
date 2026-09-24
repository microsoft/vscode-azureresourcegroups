const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
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
    };
}

const env = { TARGET_REPOSITORY: repository, TARGET_PR: '1892' };

test('reconstructs bounded UTF-8 patch chunks and complete paginated metadata', async () => {
    const snapshot = fixture();
    let cursor = 0;
    const listed = [];
    let listingSha256;
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
        if (result.complete) { break; }
    } while (true);
    assert.equal(cursor, 61);
    assert.equal(new Set(listed.map(file => file.filename)).size, 61);
    assert.ok(scoped(listed[0].filename));
    assert.ok(!scoped(listed[1].filename));
    assert.deepEqual(listed.filter(file => scoped(file.filename)).map(file => file.filename), [filename, ...otherScoped]);
    for (const path of otherScoped) {
        const result = await readPrDiff({ mode: 'diff', filename: path, baseSha: base, headSha: head }, { env, snapshot });
        assert.equal(result.chunk, '@@ -0,0 +1 @@\n+smoke');
        assert.equal(result.complete, true);
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
        if (result.complete) { break; }
    } while (true);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(''), patch);
    assert.equal(cursor, Buffer.byteLength(patch));
});

test('rejects partial listings, moved PRs, changed comparisons and missing patches', async () => {
    const invalid = [
        [snapshot => { snapshot.pages[0].pop(); }, /pagination|count/],
        [snapshot => { snapshot.after.head.sha = base; }, /closed, moved/],
        [snapshot => { snapshot.compare.files[0].additions++; }, /comparison differs/],
        [snapshot => { delete snapshot.pages[0][0].patch; }, /patch differs/],
        [snapshot => { snapshot.pages[0][0].patch = patch.slice(0, patch.lastIndexOf('\n')); snapshot.compare.files[0].patch = snapshot.pages[0][0].patch; }, /Truncated|inconsistent/],
        [snapshot => { snapshot.before.changed_files = 3001; }, /3,000-file/],
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
});

test('stdio MCP exposes only the reader and returns bounded JSON-RPC results', async () => {
    const child = spawn(process.execPath, [require.resolve('./diff-reader.cjs')], {
        env: { PATH: process.env.PATH, TARGET_REPOSITORY: repository, TARGET_PR: '1892' },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const messages = [
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_pr_diff', arguments: { mode: 'files' } } },
    ];
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stdin.end(messages.map(message => JSON.stringify(message)).join('\n') + '\n');
    const [code] = await once(child, 'close');
    assert.equal(code, 0);
    const responses = output.trim().split('\n').map(JSON.parse);
    assert.equal(responses[0].result.serverInfo.name, 'cor-review-diffs');
    assert.deepEqual(responses[1].result.tools.map(tool => tool.name), ['read_pr_diff']);
    assert.equal(responses[2].result.isError, true);
    assert.match(responses[2].result.content[0].text, /Invalid diff reader configuration/);
});
