import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const SCOPE = 'resources/agents/azure-debug-generate/';
const AGENT = 'resources/agents/azure-debug-generate.agent.md';
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

function git(repo, ...args) {
    return execFileSync('git', ['-C', repo, ...args], {
        maxBuffer: MAX_BUNDLE_BYTES + 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function text(bytes, label) {
    if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) {
        throw new Error(`Unsupported binary or oversized ${label}`);
    }
    try {
        return decoder.decode(bytes);
    } catch {
        throw new Error(`Unsupported non-UTF-8 ${label}`);
    }
}

function pathName(bytes) {
    if (bytes.length > 1024) {
        throw new Error('Unsupported oversized file name');
    }
    const name = text(bytes, 'file name');
    if (!name || name.startsWith('/') || name.split('/').includes('..') || /[\x00-\x1f\x7f]/.test(name)) {
        throw new Error(`Unsupported file name: ${JSON.stringify(name)}`);
    }
    return name;
}

function scoped(name) {
    return name === AGENT || (typeof name === 'string' && name.startsWith(SCOPE));
}

function changedFiles(repo, mergeBase, head) {
    const listing = git(repo, 'diff', '--name-status', '-z', '--no-ext-diff', '-M', mergeBase, head);
    if (listing.length && listing[listing.length - 1] !== 0) {
        throw new Error('Truncated Git file listing');
    }
    const fields = listing.length ? listing.subarray(0, -1).toString('binary').split('\0')
        .map(field => Buffer.from(field, 'binary')) : [];
    const files = [];
    for (let position = 0; position < fields.length;) {
        const status = text(fields[position++], 'Git status');
        if (!/^(A|M|D|R[0-9]+)$/.test(status)) {
            throw new Error(`Unsupported Git status: ${status}`);
        }
        if (position + (status.startsWith('R') ? 2 : 1) > fields.length) {
            throw new Error('Truncated Git file listing');
        }
        const previousFilename = status.startsWith('R') ? pathName(fields[position++]) : undefined;
        const filename = pathName(fields[position++]);
        if (!filename || (previousFilename !== undefined && !previousFilename)) {
            throw new Error('Truncated Git file listing');
        }
        files.push({ index: files.length, filename, status, ...(previousFilename && { previousFilename }) });
        if (files.length > MAX_FILES) {
            throw new Error('Git listing exceeds GitHub 3,000-file limit');
        }
    }
    return files;
}

function ensureRegularFile(repo, commit, name) {
    const entry = git(repo, 'ls-tree', '-z', commit, '--', name);
    const match = /^(100644|100755) blob [0-9a-f]{40}\t/.exec(entry.toString('utf8'));
    if (!match || !entry.subarray(match[0].length).equals(Buffer.from(`${name}\0`))) {
        throw new Error(`Unsupported file type at ${commit}: ${name}`);
    }
}

export function stageReview({ repo, output, base, head, changedCount, pullNumber }) {
    if (![base, head].every(sha => SHA.test(sha)) ||
        !Number.isSafeInteger(changedCount) || changedCount < 0 || changedCount > MAX_FILES ||
        !Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
        throw new Error('Invalid or unsupported pinned PR identity');
    }
    if (git(repo, 'rev-parse', 'HEAD').toString('utf8').trim() !== head) {
        throw new Error('Checked-out commit differs from the pinned PR head');
    }
    git(repo, 'cat-file', '-e', `${base}^{commit}`);
    const mergeBase = git(repo, 'merge-base', base, head).toString('utf8').trim();
    if (!SHA.test(mergeBase)) {
        throw new Error('Missing merge base');
    }
    const files = changedFiles(repo, mergeBase, head);
    if (files.length !== changedCount) {
        throw new Error(`PR file count mismatch: Git=${files.length}, API=${changedCount}`);
    }
    const scopedFiles = [];
    let stagedBytes = 0;
    for (const file of files) {
        if (!scoped(file.filename) && !scoped(file.previousFilename)) {
            continue;
        }
        const oldName = file.previousFilename || file.filename;
        if (file.status !== 'A') {
            ensureRegularFile(repo, mergeBase, oldName);
        }
        if (file.status !== 'D') {
            ensureRegularFile(repo, head, file.filename);
        }
        const paths = file.previousFilename ? [oldName, file.filename] : [file.filename];
        const patch = text(git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--no-color',
            '--binary', '--full-index', '-M', mergeBase, head, '--', ...paths), `patch: ${file.filename}`);
        if ((patch.match(/^diff --git /gm) || []).length !== 1 ||
            /^(?:Binary files |GIT binary patch$)/m.test(patch)) {
            throw new Error(`Missing or unsupported patch: ${file.filename}`);
        }
        const headText = file.status === 'D' ? null :
            text(git(repo, 'show', `${head}:${file.filename}`), `head file: ${file.filename}`);
        stagedBytes += Buffer.byteLength(patch) + (headText === null ? 0 : Buffer.byteLength(headText));
        if (stagedBytes > MAX_BUNDLE_BYTES) {
            throw new Error('Scoped evidence exceeds staging limit');
        }
        scopedFiles.push({ ...file, patch, headText });
    }
    const bundle = { pullNumber, base, head, mergeBase, changedCount, files, scopedFiles };
    const serialized = JSON.stringify(bundle);
    if (Buffer.byteLength(serialized) > MAX_BUNDLE_BYTES * 2) {
        throw new Error('Serialized evidence exceeds staging limit');
    }
    mkdirSync(output, { recursive: false, mode: 0o700 });
    writeFileSync(join(output, 'bundle.json'), serialized, { flag: 'wx', mode: 0o600 });
    return { changedCount, scopedCount: scopedFiles.length, stagedBytes, mergeBase };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = stageReview({
        repo: process.env.REVIEW_CHECKOUT,
        output: process.env.REVIEW_BUNDLE_DIR,
        base: process.env.REVIEW_BASE,
        head: process.env.REVIEW_HEAD,
        changedCount: Number(process.env.REVIEW_CHANGED_COUNT),
        pullNumber: Number(process.env.REVIEW_PULL_NUMBER),
    });
    console.log(JSON.stringify(result));
}
