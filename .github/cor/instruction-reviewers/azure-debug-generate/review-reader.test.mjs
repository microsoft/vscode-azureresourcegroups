import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createReader } from './review-reader.mjs';
import { stageReview } from './stage-review.mjs';

const readerScript = fileURLToPath(new URL('./review-reader.mjs', import.meta.url));

function git(repo, ...args) {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function fixture(run) {
    const root = mkdtempSync(join(tmpdir(), 'staged-review-test-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    try {
        git(repo, 'init', '-q');
        git(repo, 'config', 'user.name', 'Test');
        git(repo, 'config', 'user.email', 'test@example.org');
        return run(root, repo);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function commit(repo) {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'fixture');
    return git(repo, 'rev-parse', 'HEAD');
}

function stage(root, repo, base, head, changedCount) {
    const output = join(root, `evidence-${Math.random().toString(36).slice(2)}`);
    const result = stageReview({ repo, output, base, head, changedCount, pullNumber: 1892 });
    return { result, bundle: JSON.parse(readFileSync(join(output, 'bundle.json'), 'utf8')), output };
}

test('stages all files including a scoped rename beyond position 300, then reads complete UTF-8 chunks over stdio', () => {
    fixture((root, repo) => {
        mkdirSync(join(repo, 'ordinary'));
        writeFileSync(join(repo, 'ordinary', 'rename-me.md'), 'unchanged rename\n');
        const base = commit(repo);
        for (let i = 0; i < 310; i++) {
            writeFileSync(join(repo, 'ordinary', `file-${String(i).padStart(3, '0')}.txt`), 'ordinary\n');
        }
        const scope = join(repo, 'resources/agents/azure-debug-generate/references');
        mkdirSync(scope, { recursive: true });
        git(repo, 'mv', 'ordinary/rename-me.md', 'resources/agents/azure-debug-generate/references/renamed.md');
        writeFileSync(join(scope, 'unicode.md'), 'é☃\n'.repeat(9000));
        const head = commit(repo);
        const { result, bundle, output } = stage(root, repo, base, head, 312);
        assert.equal(result.changedCount, 312);
        assert.equal(result.scopedCount, 2);
        assert.ok(bundle.scopedFiles.every(file => file.index > 300));
        assert.ok(bundle.scopedFiles.some(file => file.previousFilename === 'ordinary/rename-me.md'));
        const reader = createReader(bundle);
        const files = [];
        for (let offset = 0; offset < bundle.changedCount;) {
            const page = reader.call('review_manifest', { offset });
            assert.ok(page.files.length <= 50);
            assert.ok(Buffer.byteLength(JSON.stringify(page.files)) <= 8192);
            files.push(...page.files);
            offset = page.nextOffset;
        }
        assert.equal(files.length, 312);
        const unicode = bundle.scopedFiles.find(file => file.filename.endsWith('unicode.md'));
        for (const kind of ['patch', 'head']) {
            let contents = '';
            let offset = 0;
            let chunks = 0;
            do {
                const chunk = reader.call('review_chunk', { index: unicode.index, kind, offset });
                assert.ok(Buffer.byteLength(chunk.text) <= 8192);
                assert.ok(chunk.nextOffset > offset);
                contents += chunk.text;
                offset = chunk.nextOffset;
                chunks++;
            } while (offset < Buffer.byteLength(kind === 'patch' ? unicode.patch : unicode.headText));
            assert.equal(contents, kind === 'patch' ? unicode.patch : unicode.headText);
            assert.ok(chunks > 3);
        }
        assert.throws(() => reader.call('review_chunk', { index: unicode.index, kind: 'head', offset: 1 }),
            /splits a UTF-8 character/);
        assert.throws(() => reader.call('review_chunk', { index: 0, kind: 'patch', offset: 0 }), /Invalid scoped/);
        assert.throws(() => reader.call('review_manifest', { offset: 313 }), /Invalid manifest offset/);
        const requests = [
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            { jsonrpc: '2.0', id: 3, method: 'tools/call',
                params: { name: 'review_manifest', arguments: { offset: 300 } } },
        ];
        const server = spawnSync(process.execPath, [readerScript], {
            env: { REVIEW_BUNDLE_DIR: output },
            input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
            encoding: 'utf8',
        });
        assert.equal(server.status, 0, server.stderr);
        const responses = server.stdout.trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(responses.map(response => response.id), [1, 2, 3]);
        assert.deepEqual(responses[1].result.tools.map(tool => tool.name), ['review_manifest', 'review_chunk']);
        assert.equal(JSON.parse(responses[2].result.content[0].text).files.length, 12);
    });
});

test('fails closed on stale count, head, binary content, and unsupported symlink', () => {
    fixture((root, repo) => {
        writeFileSync(join(repo, 'initial.txt'), 'base\n');
        const base = commit(repo);
        const scope = join(repo, 'resources/agents/azure-debug-generate');
        mkdirSync(scope, { recursive: true });
        writeFileSync(join(scope, 'instructions.md'), 'changed\n');
        const head = commit(repo);
        assert.throws(() => stage(root, repo, base, head, 2), /file count mismatch/);
        assert.throws(() => stage(root, repo, base, base, 1), /Checked-out commit differs/);
        assert.throws(() => stage(root, repo, base, head, 3001), /Invalid or unsupported pinned/);
        writeFileSync(join(scope, 'binary.dat'), Buffer.from([0, 1, 2]));
        const binaryHead = commit(repo);
        assert.throws(() => stage(root, repo, base, binaryHead, 2), /unsupported patch/);
        rmSync(join(scope, 'binary.dat'));
        symlinkSync('instructions.md', join(scope, 'link.md'));
        const linkHead = commit(repo);
        assert.throws(() => stage(root, repo, base, linkHead, 2), /Unsupported file type/);
        rmSync(join(scope, 'link.md'));
        writeFileSync(join(scope, 'invalid.md'), Buffer.from([0xc3, 0x28]));
        const invalidHead = commit(repo);
        assert.throws(() => stage(root, repo, base, invalidHead, 2), /non-UTF-8/);
    });
});

test('stages deletions with no proposed head file and accepts verified empty scope', () => {
    fixture((root, repo) => {
        const scope = join(repo, 'resources/agents/azure-debug-generate');
        mkdirSync(scope, { recursive: true });
        writeFileSync(join(scope, 'obsolete.md'), 'deleted rule\n');
        const base = commit(repo);
        rmSync(join(scope, 'obsolete.md'));
        const head = commit(repo);
        const { bundle } = stage(root, repo, base, head, 1);
        assert.equal(bundle.scopedFiles[0].headText, null);
        assert.match(bundle.scopedFiles[0].patch, /-deleted rule/);
        assert.throws(() => createReader(bundle).call('review_chunk', {
            index: 0, kind: 'head', offset: 0,
        }), /Invalid scoped file/);
        writeFileSync(join(repo, 'unrelated.txt'), 'not scoped\n');
        const unrelatedHead = commit(repo);
        const empty = stage(root, repo, head, unrelatedHead, 1).bundle;
        assert.equal(empty.scopedFiles.length, 0);
        assert.equal(createReader(empty).call('review_manifest', { offset: 0 }).files.length, 1);
    });
});

test('replays the actual #1892 patches through the containerized stdio protocol', {
    skip: process.env.REPLAY_PR_1892 !== '1',
}, async () => {
    const root = mkdtempSync(join(tmpdir(), 'staged-review-1892-'));
    const repo = join(root, 'repo');
    const base = '5a564544ee12d00fc276effdc2f26c611e85a754';
    const head = '90e65bd6af6f0abe86794bb61455fc1ceb371e9b';
    try {
        const checkoutStarted = Date.now();
        execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', '.', repo]);
        git(repo, 'checkout', '--quiet', head);
        const checkoutMs = Date.now() - checkoutStarted;
        const stageStarted = Date.now();
        const { result, bundle, output } = stage(root, repo, base, head, 61);
        const stagingMs = Date.now() - stageStarted;
        const image = 'ghcr.io/github/gh-aw-node@sha256:0daa8971fa4732b647150cb6524a6b0804b68d5d24f6f58b5dd1af23bd63fb23';
        const child = spawn('docker', ['run', '--rm', '-i', '--network', 'none',
            '--mount', `type=bind,source=${readerScript},target=/review/reader.mjs,readonly`,
            '--mount', `type=bind,source=${join(output, 'bundle.json')},target=/review/bundle.json,readonly`,
            '-e', 'REVIEW_BUNDLE_DIR=/review', '--entrypoint', 'node', image, '/review/reader.mjs']);
        const responses = new Map();
        let nextId = 0;
        let stderr = '';
        child.stderr.on('data', data => { stderr += data; });
        const exited = new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', code => {
                for (const pending of responses.values()) {
                    pending.reject(new Error(`Reader exited ${code}: ${stderr}`));
                }
                resolve(code);
            });
        });
        const lines = createInterface({ input: child.stdout });
        lines.on('line', line => {
            const message = JSON.parse(line);
            const pending = responses.get(message.id);
            responses.delete(message.id);
            if (message.error || message.result?.isError) {
                pending.reject(new Error(JSON.stringify(message.error || message.result.content)));
            } else {
                pending.resolve(message.result);
            }
        });
        function request(method, params = {}) {
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                responses.set(id, { resolve, reject });
                child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
            });
        }
        const init = await request('initialize', { protocolVersion: '2025-06-18' });
        assert.equal(init.serverInfo.name, 'staged-review');
        const tools = await request('tools/list');
        assert.deepEqual(tools.tools.map(tool => tool.name), ['review_manifest', 'review_chunk']);
        const read = async (name, args) => {
            const result = await request('tools/call', { name, arguments: args });
            return JSON.parse(result.content[0].text);
        };
        const files = [];
        for (let offset = 0; offset < result.changedCount;) {
            const page = await read('review_manifest', { offset });
            files.push(...page.files);
            offset = page.nextOffset;
        }
        assert.equal(files.length, 61);
        let patchBytes = 0;
        let patchChunks = 0;
        let generatePatchChunks = 0;
        for (const file of bundle.scopedFiles) {
            let patch = '';
            for (let offset = 0;;) {
                const chunk = await read('review_chunk', { index: file.index, kind: 'patch', offset });
                assert.ok(Buffer.byteLength(chunk.text) <= 8192);
                patch += chunk.text;
                patchBytes += Buffer.byteLength(chunk.text);
                patchChunks++;
                if (file.filename.endsWith('/generate.md')) {
                    generatePatchChunks++;
                }
                offset = chunk.nextOffset;
                if (offset === chunk.totalBytes) {
                    break;
                }
            }
            assert.equal(patch, file.patch);
        }
        assert.equal(bundle.scopedFiles.length, 21);
        assert.ok(patchBytes > 27044);
        const generatePatchBytes = Buffer.byteLength(bundle.scopedFiles.find(file =>
            file.filename.endsWith('/generate.md')).patch);
        assert.ok(generatePatchBytes > 27044);
        assert.ok(generatePatchChunks > 1);
        console.log(JSON.stringify({ changedFiles: files.length, scopedFiles: bundle.scopedFiles.length,
            patchBytes, patchChunks, generatePatchBytes, generatePatchChunks, stagedBytes: result.stagedBytes,
            serializedBytes: statSync(join(output, 'bundle.json')).size, checkoutMs, stagingMs }));
        child.stdin.end();
        assert.equal(await exited, 0, stderr);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
