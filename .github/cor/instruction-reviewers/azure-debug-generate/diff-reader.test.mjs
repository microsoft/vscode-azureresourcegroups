import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const directory = new URL('./', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('fixtures/pr-1892.json', directory), 'utf8'));
const workflow = readFileSync(new URL('../../../workflows/cor-debug-generate-review.md', directory), 'utf8');
const scriptBlock = workflow.match(/^    script: \|\n([\s\S]*?)^safe-outputs:/m)?.[1];
assert.ok(scriptBlock, 'Expected the workflow to define the callable diff reader');
const script = scriptBlock.split('\n').map(line => line.startsWith('      ') ? line.slice(6) : line).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('inputs', 'fetch', 'process', 'require', 'AbortSignal',
  `const { mode, cursor, filename, baseSha, headSha } = inputs;\n${script}`);
const repository = 'microsoft/vscode-azureresourcegroups';
const base = '5a564544ee12d00fc276effdc2f26c611e85a754';
const head = '90e65bd6af6f0abe86794bb61455fc1ceb371e9b';
const filename = 'resources/agents/azure-debug-generate/references/generate.md';

function reader(files = fixture.files, options = {}) {
  let pullReads = 0;
  const count = options.count ?? files.length;
  const pull = () => ({
    state: options.closed ? 'closed' : 'open',
    changed_files: count,
    base: { sha: base, repo: { id: 42, full_name: repository } },
    head: { sha: options.stale && ++pullReads > 1 ? 'f'.repeat(40) : head, repo: { id: 42 } },
  });
  const fetch = async url => {
    const path = new URL(url).pathname;
    let data;
    if (path.endsWith('/pulls/1892')) data = pull();
    else if (path.includes('/compare/')) data = {
      merge_base_commit: { sha: base }, files: options.compareFiles ?? files,
    };
    else if (path.endsWith('/pulls/1892/files')) {
      const page = Number(new URL(url).searchParams.get('page'));
      data = files.slice((page - 1) * 100, page * 100);
    } else throw Error(`Unexpected API request: ${path}`);
    return { ok: true, json: async () => data };
  };
  const env = {
    GH_TOKEN: 'test-read-only-token', TARGET_REPOSITORY: repository, TARGET_PR: '1892',
    EXPECTED_BASE_SHA: options.manual ? '' : base,
    EXPECTED_HEAD_SHA: options.manual ? '' : head,
  };
  return inputs => execute(inputs, fetch, { env }, requireBuiltin, AbortSignal);
}

function requireBuiltin(name) {
  assert.equal(name, 'node:crypto');
  return requireCrypto;
}
const requireCrypto = await import('node:crypto');

test('lists all 61 PR files without leaking patches, then reconstructs the 27 KB patch', async () => {
  const read = reader();
  const listed = [];
  let cursor = 0;
  let digest;
  do {
    const result = await read({ mode: 'files', cursor });
    assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] })) <= 7000);
    assert.equal(result.changedFiles, 61);
    assert.equal(result.baseSha, base);
    assert.equal(result.headSha, head);
    if (digest) assert.equal(result.listingSha256, digest);
    digest = result.listingSha256;
    assert.ok(result.nextCursor > cursor);
    listed.push(...result.files);
    cursor = result.nextCursor;
    if (result.complete) break;
  } while (cursor < 61);
  assert.equal(cursor, 61);
  assert.equal(new Set(listed.map(file => file.filename)).size, 61);
  assert.equal(listed.filter(file => file.filename === 'resources/agents/azure-debug-generate.agent.md' ||
    file.filename.startsWith('resources/agents/azure-debug-generate/')).length, 21);
  assert.ok(listed.every(file => !('patch' in file)));
  assert.equal(digest, createHash('sha256').update(JSON.stringify(listed)).digest('hex'));

  const patch = fixture.files.find(file => file.filename === filename).patch;
  let assembled = '';
  cursor = 0;
  do {
    const result = await read({ mode: 'diff', filename, cursor });
    assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] })) <= 7000);
    assert.equal(result.offset, cursor);
    assert.equal(result.totalBytes, Buffer.byteLength(patch));
    assert.ok(result.nextCursor > cursor);
    assert.equal(result.nextCursor - cursor, Buffer.byteLength(result.chunk));
    assembled += result.chunk;
    cursor = result.nextCursor;
    if (result.complete) {
      assert.equal(cursor, result.totalBytes);
      break;
    }
  } while (cursor < Buffer.byteLength(patch));
  assert.equal(assembled, patch);
  const bytes = Buffer.from(patch);
  const unicode = bytes.findIndex(byte => byte >= 0xc0);
  assert.ok(unicode > 0);
  await assert.rejects(read({ mode: 'diff', filename, cursor: unicode + 1 }), /UTF-8/);
});

test('fails closed on stale heads, missing pages, truncated patches, and mismatched comparisons', async () => {
  await assert.rejects(reader(fixture.files, { stale: true })({ mode: 'files' }), /moved/);
  await assert.rejects(reader(fixture.files, { count: 62 })({ mode: 'files' }), /pagination/);
  const truncated = fixture.files.map(file => file.filename === filename ?
    { ...file, patch: file.patch.slice(0, -100) } : file);
  await assert.rejects(reader(truncated, { compareFiles: fixture.files })({ mode: 'diff', filename }), /patch/);
  await assert.rejects(reader(fixture.files, { compareFiles: fixture.files.slice(1) })({ mode: 'files' }), /comparison/);
  await assert.rejects(reader(fixture.files, { count: 3001 })({ mode: 'files' }), /3,000/);
  await assert.rejects(reader()({ mode: 'diff', filename: '../other' }), /outside/);
  await assert.rejects(reader(fixture.files, { closed: true })({ mode: 'files' }), /closed/);
  const overflowing = Array.from({ length: 101 }, (_, index) => ({
    filename: `docs/file-${index}.md`, status: 'added',
    additions: 1, deletions: 0, changes: 1, patch: '@@ -0,0 +1 @@\n+new',
  }));
  await assert.rejects(reader(overflowing, {
    count: 100, compareFiles: overflowing.slice(0, 100),
  })({ mode: 'files' }), /file count/);
});

test('requires recorded SHAs after manual listing and rejects stale manual requests', async () => {
  const read = reader(fixture.files, { manual: true });
  const first = await read({ mode: 'files' });
  assert.equal(first.headSha, head);
  const second = await read({ mode: 'files', cursor: first.nextCursor, baseSha: base, headSha: head });
  assert.equal(second.listingSha256, first.listingSha256);
  await assert.rejects(read({ mode: 'files', headSha: 'f'.repeat(40), baseSha: base }), /moved/);
});

test('returns pure renames and deletions as scoped diff evidence', async () => {
  const files = [
    { filename: 'elsewhere/renamed.md', previous_filename: filename, status: 'renamed',
      additions: 0, deletions: 0, changes: 0 },
    { filename: 'resources/agents/azure-debug-generate/deleted.md', status: 'removed',
      additions: 0, deletions: 1, changes: 1, patch: '@@ -1 +0,0 @@\n-old' },
  ];
  const read = reader(files);
  const renamed = await read({ mode: 'diff', filename: files[0].filename });
  assert.equal(renamed.previousFilename, filename);
  assert.equal(renamed.chunk, '');
  assert.equal(renamed.complete, true);
  const removed = await read({ mode: 'diff', filename: files[1].filename });
  assert.equal(removed.chunk, files[1].patch);
});

test('rejects patches omitted or shortened without changing the PR file metadata', async () => {
  const file = fixture.files.find(entry => entry.filename === filename);
  const read = reader([{ ...file, patch: undefined }], { compareFiles: [file] });
  await assert.rejects(read({ mode: 'diff', filename }), /comparison|omitted/);
  const short = file.patch.replace(' # Artifact Generation', ' # Artifact');
  await assert.rejects(reader([{ ...file, patch: short }], { compareFiles: [file] })({ mode: 'diff', filename }), /comparison|patch/);
});

test('lists more than 300 files, but refuses unverifiable scoped patches past the compare limit', async () => {
  const files = Array.from({ length: 301 }, (_, index) => ({
    filename: index === 300 ? filename : `docs/file-${index}.md`,
    status: 'added', additions: 1, deletions: 0, changes: 1,
    patch: '@@ -0,0 +1 @@\n+added',
  }));
  const read = reader(files, { compareFiles: files.slice(0, 300) });
  let cursor = 0;
  const listed = [];
  do {
    const result = await read({ mode: 'files', cursor });
    listed.push(...result.files);
    cursor = result.nextCursor;
    if (result.complete) break;
  } while (cursor < 301);
  assert.equal(listed.length, 301);
  await assert.rejects(read({ mode: 'diff', filename }), /immutable comparison limit/);
});

test('bounds escaped large patches and handles a scope-empty PR', async () => {
  const patch = `@@ -0,0 +1 @@\n+${'\\\\\"'.repeat(30000)}`;
  const read = reader([{ filename, status: 'added', additions: 1, deletions: 0, changes: 1, patch }]);
  let cursor = 0;
  let assembled = '';
  do {
    const result = await read({ mode: 'diff', filename, cursor });
    assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] })) <= 7000);
    assembled += result.chunk;
    cursor = result.nextCursor;
    if (result.complete) break;
  } while (cursor < Buffer.byteLength(patch));
  assert.equal(assembled, patch);
  const empty = await reader([])({ mode: 'files', cursor: 0 });
  assert.equal(empty.changedFiles, 0);
  assert.equal(empty.complete, true);
});

test('reads the live #1892 API response through the workflow tool', { skip: !process.env.COR_REVIEW_LIVE }, async () => {
  const env = {
    GH_TOKEN: process.env.GH_TOKEN, TARGET_REPOSITORY: repository, TARGET_PR: '1892',
    EXPECTED_BASE_SHA: base, EXPECTED_HEAD_SHA: head,
  };
  const read = inputs => execute(inputs, globalThis.fetch, { env }, requireBuiltin, AbortSignal);
  const listing = await read({ mode: 'files', cursor: 0 });
  assert.equal(listing.changedFiles, 61);
  let cursor = 0;
  let patch = '';
  do {
    const chunk = await read({ mode: 'diff', filename, cursor });
    assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(chunk) }] })) <= 7000);
    patch += chunk.chunk;
    cursor = chunk.nextCursor;
    if (chunk.complete) break;
  } while (cursor < 30000);
  assert.equal(patch, fixture.files.find(file => file.filename === filename).patch);
});
