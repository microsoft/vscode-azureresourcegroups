/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createInterface } = require('node:readline');

const shaPattern = /^[a-f0-9]{40}$/i;
const emptyBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const missingBlob = '0'.repeat(40);
const regularModes = new Set(['000000', '100644', '100755']);
const scoped = path => path === 'resources/agents/azure-debug-generate.agent.md' ||
    path?.startsWith('resources/agents/azure-debug-generate/');
const sha256 = value => createHash('sha256').update(value).digest('hex');

let cachedReview;

function git(checkout, ...args) {
    const bytes = execFileSync('git', [
        '-c', `safe.directory=${checkout}`, '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-C', checkout, ...args,
    ], {
        maxBuffer: 18 * 1024 * 1024,
        env: {
            PATH: process.env.PATH, HOME: '/tmp', GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1',
            GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
        },
    });
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
        throw new Error('Git diff contains invalid UTF-8');
    }
    return text;
}

function checkPull(pull, repository, base, head) {
    if (pull?.state !== 'open' || pull.base?.repo?.full_name !== repository ||
        pull.head?.repo?.id !== pull.base?.repo?.id ||
        pull.base?.sha !== base || pull.head?.sha !== head) {
        throw new Error('PR closed, moved, or is not from the same repository');
    }
}

function readGitFiles(checkout, base, head, count) {
    if (git(checkout, 'rev-parse', 'HEAD').trim() !== head) {
        throw new Error('Checkout does not match the recorded head SHA');
    }
    git(checkout, 'rev-parse', '--verify', `${base}^{commit}`);
    const mergeBases = git(checkout, 'merge-base', '--all', base, head).trim().split('\n');
    if (mergeBases.length !== 1 || !shaPattern.test(mergeBases[0])) {
        throw new Error('PR does not have a unique merge base');
    }
    const mergeBaseSha = mergeBases[0];
    const range = [mergeBaseSha, head];
    const records = git(checkout, 'diff-tree', '-r', '--no-commit-id', '--raw', '-z',
        '--find-renames', ...range).split('\0');
    const stats = git(checkout, 'diff', '--numstat', '-z', '--find-renames',
        '--no-ext-diff', '--no-textconv', ...range).split('\0');
    const files = [];
    let statIndex = 0;
    for (let i = 0; records[i];) {
        const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMDTRC])(\d*)$/.exec(records[i++]);
        if (!match) {
            throw new Error('Invalid Git tree diff record');
        }
        const oldName = records[i++];
        const renamed = match[5] === 'R' || match[5] === 'C';
        const filename = renamed ? records[i++] : oldName;
        const stat = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(stats[statIndex++]);
        if (!stat) {
            throw new Error('Invalid Git numstat record');
        }
        let statName = stat[3];
        if (renamed) {
            // NUL-delimited numstat puts both rename paths after an empty field.
            if (statName || stats[statIndex++] !== oldName) {
                throw new Error('Git rename paths disagree');
            }
            statName = stats[statIndex++];
        }
        if (filename !== statName) {
            throw new Error('Git tree diff and numstat disagree');
        }
        const binary = stat[1] === '-' || stat[2] === '-';
        const additions = binary ? 0 : Number(stat[1]);
        const deletions = binary ? 0 : Number(stat[2]);
        files.push({
            filename, previous_filename: renamed ? oldName : undefined,
            status: { A: 'added', M: 'modified', D: 'removed', T: 'modified',
                R: 'renamed', C: 'copied' }[match[5]],
            oldMode: match[1], newMode: match[2],
            additions, deletions, changes: additions + deletions, binary,
            oldBlob: match[3], newBlob: match[4],
        });
    }
    if (statIndex !== stats.length - 1 || files.length !== count) {
        throw new Error('Git file count does not match PR changed_files');
    }
    return { mergeBaseSha, files };
}

function prepareReview(data, { repository, pr, expectedBase, expectedHead, checkout }) {
    if (data.error) {
        throw new Error(`Diff snapshot preparation failed: ${data.error}`);
    }
    if (data.repository !== repository || data.pr !== pr) {
        throw new Error('Diff snapshot does not match the requested PR');
    }
    const base = expectedBase || data.before?.base?.sha;
    const head = expectedHead || data.before?.head?.sha;
    if (!shaPattern.test(base) || !shaPattern.test(head)) {
        throw new Error('Invalid PR commit SHAs');
    }
    checkPull(data.before, repository, base, head);
    const count = data.before.changed_files;
    if (!Number.isSafeInteger(count) || count < 0 || count > 3000) {
        throw new Error('PR changed-file count exceeds the 3,000-file API limit');
    }
    checkPull(data.after, repository, base, head);

    const { mergeBaseSha, files } = readGitFiles(checkout, base, head, count);
    const names = new Set();
    for (const file of files) {
        if (typeof file.filename !== 'string' || !file.filename ||
            names.has(file.filename) || typeof file.status !== 'string' ||
            !Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions) ||
            file.changes !== file.additions + file.deletions ||
            file.status === 'renamed' && !file.previous_filename) {
            throw new Error('Invalid or duplicated PR file metadata');
        }
        names.add(file.filename);
    }
    // One digest identifies the complete listing across all bounded responses.
    const metadata = files.map(({ filename, previous_filename, status, additions, deletions, changes, oldMode, newMode }) =>
        ({ filename, previous_filename, status, additions, deletions, changes, oldMode, newMode }));
    return { base, head, mergeBaseSha, count, files, metadata, listingSha256: sha256(JSON.stringify(metadata)), checkout };
}

function responseFits(value) {
    // JSON escaping and the MCP envelope count toward the CLI output limit.
    return Buffer.byteLength(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(value) }],
    })) <= 7000;
}

function listChangedFiles(review, position, filename) {
    if (filename !== undefined || position > review.count) {
        throw new Error('Invalid listing request');
    }
    const { base, head, mergeBaseSha, count, metadata, listingSha256 } = review;
    const result = {
        baseSha: base, headSha: head, mergeBaseSha, changedFiles: count, listingSha256,
        files: [], nextCursor: position, complete: position === count,
    };
    for (let i = position; i < count; i++) {
        result.files.push(metadata[i]);
        result.nextCursor = i + 1;
        result.complete = result.nextCursor === count;
        if (!responseFits(result)) {
            result.files.pop();
            if (!result.files.length) {
                throw new Error('A filename exceeds the response limit');
            }
            result.nextCursor = i;
            result.complete = false;
            break;
        }
    }
    return result;
}

function verifyPatch(file, checkout) {
    if (file.binary || !regularModes.has(file.oldMode) || !regularModes.has(file.newMode)) {
        throw new Error('Scoped file has an unsupported binary or object type');
    }
    // Blob IDs, not PR-controlled paths, are the only variable Git arguments.
    const oldBlob = file.oldBlob === missingBlob ? emptyBlob : file.oldBlob;
    const newBlob = file.newBlob === missingBlob ? emptyBlob : file.newBlob;
    const output = git(checkout, 'diff', '--no-ext-diff', '--no-textconv',
        '--no-color', '--unified=3', oldBlob, newBlob);
    const firstHunk = /^@@ -/m.exec(output);
    const patch = firstHunk ? output.slice(firstHunk.index).replace(/\n$/, '') : '';
    if (file.changes && !patch) {
        throw new Error('Missing scoped Git patch');
    }
    if (!file.changes && file.status !== 'renamed' && file.status !== 'copied' &&
        file.oldMode === file.newMode) {
        throw new Error('Cannot establish a diff for a changed file');
    }

    let additions = 0;
    let deletions = 0;
    let oldRemaining = 0;
    let newRemaining = 0;
    let hunks = 0;
    // Numstat counts detect omitted whole hunks that valid hunk headers would not.
    for (const line of patch ? patch.split('\n') : []) {
        const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
        if (header) {
            if (oldRemaining || newRemaining) {
                throw new Error('Truncated patch hunk');
            }
            oldRemaining = header[1] === undefined ? 1 : Number(header[1]);
            newRemaining = header[2] === undefined ? 1 : Number(header[2]);
            hunks++;
        } else if (line.startsWith('\\ No newline at end of file')) {
            continue;
        } else if (hunks && (oldRemaining || newRemaining)) {
            if (line.startsWith('+')) {
                additions++;
                newRemaining--;
            } else if (line.startsWith('-')) {
                deletions++;
                oldRemaining--;
            } else if (line.startsWith(' ')) {
                oldRemaining--;
                newRemaining--;
            } else {
                throw new Error('Invalid patch line');
            }
            if (oldRemaining < 0 || newRemaining < 0) {
                throw new Error('Patch hunk exceeds declared size');
            }
        } else {
            throw new Error('Patch has unaccounted data');
        }
    }
    if (oldRemaining || newRemaining || additions !== file.additions ||
        deletions !== file.deletions || file.changes && !hunks) {
        throw new Error('Truncated or inconsistent Git patch');
    }
    return Buffer.from(patch, 'utf8');
}

function utf8Boundary(bytes, end) {
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
        end--;
    }
    return end;
}

function readPatchChunk(review, filename, position) {
    const file = review.files.find(entry => entry.filename === filename);
    if (!file || !scoped(file.filename) && !scoped(file.previous_filename)) {
        throw new Error('Diff request is outside the reviewed files');
    }
    const bytes = verifyPatch(file, review.checkout);
    if (position > bytes.length || position < bytes.length && (bytes[position] & 0xc0) === 0x80) {
        throw new Error('Diff cursor is not a UTF-8 character boundary');
    }
    let end = utf8Boundary(bytes, Math.min(position + 5500, bytes.length));
    const result = {
        baseSha: review.base, headSha: review.head, mergeBaseSha: review.mergeBaseSha,
        filename, previousFilename: file.previous_filename,
        status: file.status, oldMode: file.oldMode, newMode: file.newMode,
        offset: position, totalBytes: bytes.length, sha256: sha256(bytes),
        chunk: bytes.subarray(position, end).toString('utf8'), nextCursor: end, complete: end === bytes.length,
    };
    while (!responseFits(result) && end > position) {
        end = utf8Boundary(bytes, Math.max(position, end - 256));
        result.chunk = bytes.subarray(position, end).toString('utf8');
        result.nextCursor = end;
        result.complete = end === bytes.length;
    }
    if (!responseFits(result) || end === position && position < bytes.length) {
        throw new Error('Diff chunk exceeds the response limit');
    }
    return result;
}

async function readPrDiff({ mode, cursor, filename, baseSha, headSha }, { env = process.env, snapshot } = {}) {
    const repository = env.TARGET_REPOSITORY;
    const pr = Number(env.TARGET_PR);
    const checkout = env.CHECKOUT_PATH;
    const position = cursor ?? 0;

    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(pr) || pr < 1 ||
        !snapshot && !env.SNAPSHOT_PATH || typeof checkout !== 'string' || !checkout.startsWith('/')) {
        throw new Error('Invalid diff reader configuration');
    }
    if (env.GH_TOKEN || env.GITHUB_TOKEN || env.GITHUB_MCP_SERVER_TOKEN) {
        throw new Error('Diff reader must not receive GitHub credentials');
    }

    if (mode !== 'files' && mode !== 'diff') {
        throw new Error('Invalid mode');
    }

    if (!Number.isSafeInteger(position) || position < 0) {
        throw new Error('Invalid cursor position');
    }

    if (!env.EXPECTED_BASE_SHA && (mode !== 'files' || position !== 0) &&
        (!baseSha || !headSha)) {
        throw new Error('Recorded commit SHAs required after initial listing');
    }

    // Event SHAs pin automatic runs; manual runs record SHAs on the first listing.
    const expectedBase = env.EXPECTED_BASE_SHA || baseSha;
    const expectedHead = env.EXPECTED_HEAD_SHA || headSha;
    if ((expectedBase || expectedHead) && (!shaPattern.test(expectedBase) || !shaPattern.test(expectedHead))) {
        throw new Error('Both recorded commit SHAs are required');
    }

    if (env.EXPECTED_BASE_SHA && baseSha && baseSha !== expectedBase ||
        env.EXPECTED_HEAD_SHA && headSha && headSha !== expectedHead) {
        throw new Error('Event commit SHA mismatch');
    }

    const config = { repository, pr, expectedBase, expectedHead, checkout };
    const review = snapshot
        ? prepareReview(snapshot, config)
        : (cachedReview ??= prepareReview(JSON.parse(readFileSync(env.SNAPSHOT_PATH, 'utf8')), config));
    if (mode === 'files') {
        return listChangedFiles(review, position, filename);
    }

    return readPatchChunk(review, filename, position);
}

const tool = {
    name: 'read_pr_diff',
    description: 'List every changed file or read a bounded, verified chunk of a scoped PR patch.',
    inputSchema: {
        type: 'object',
        properties: {
            mode: { type: 'string', enum: ['files', 'diff'] },
            cursor: { type: 'number', description: 'File index for files, UTF-8 byte offset for diff.' },
            filename: { type: 'string', description: 'Exact scoped filename returned by files mode; required for diff.' },
            baseSha: { type: 'string', description: 'Recorded base SHA from the first files response.' },
            headSha: { type: 'string', description: 'Recorded head SHA from the first files response.' },
        },
        required: ['mode'],
    },
};

// Stdio MCP uses one JSON-RPC message per line; this process opens no port.
async function serve() {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })}\n`);
            continue;
        }
        if (message.method === 'notifications/initialized') {
            continue;
        }
        const response = { jsonrpc: '2.0', id: message.id };
        if (message.method === 'initialize') {
            response.result = {
                protocolVersion: '2025-03-26', capabilities: { tools: {} },
                serverInfo: { name: 'cor-review-diffs', version: '1.0.0' },
            };
        } else if (message.method === 'ping') {
            response.result = {};
        } else if (message.method === 'tools/list') {
            response.result = { tools: [tool] };
        } else if (message.method === 'tools/call' && message.params?.name === tool.name) {
            try {
                const result = await readPrDiff(message.params.arguments ?? {});
                response.result = { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (error) {
                response.result = {
                    isError: true,
                    content: [{ type: 'text', text: error instanceof Error ? error.message : 'Diff reader failed' }],
                };
            }
        } else {
            response.error = { code: -32601, message: 'Unknown method or tool' };
        }
        if (message.id !== undefined) {
            process.stdout.write(`${JSON.stringify(response)}\n`);
        }
    }
}

if (require.main === module) {
    serve().catch(error => {
        console.error('Diff reader stdio server failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { readPrDiff, scoped };
