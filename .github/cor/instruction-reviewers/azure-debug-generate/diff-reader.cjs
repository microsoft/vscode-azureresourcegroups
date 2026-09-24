/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createInterface } = require('node:readline');

const scoped = path => path === 'resources/agents/azure-debug-generate.agent.md' ||
    path?.startsWith('resources/agents/azure-debug-generate/');

let stagedSnapshot;

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

async function readPrDiff({ mode, cursor, filename, baseSha, headSha }, { env = process.env, snapshot } = {}) {
    const repository = env.TARGET_REPOSITORY;
    const pr = Number(env.TARGET_PR);
    const shaPattern = /^[a-f0-9]{40}$/i;
    const position = cursor ?? 0;

    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(pr) || pr < 1 ||
        !snapshot && !env.SNAPSHOT_PATH) {
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

    const data = snapshot || (stagedSnapshot ??= JSON.parse(readFileSync(env.SNAPSHOT_PATH, 'utf8')));
    if (data.error) {
        throw new Error(`Diff snapshot preparation failed: ${data.error}`);
    }
    if (data.repository !== repository || data.pr !== pr || !Array.isArray(data.files)) {
        throw new Error('Diff snapshot does not match the requested PR');
    }

    const pull = data.before;
    function checkPull(current, base, head) {
        if (current.state !== 'open' || current.base?.repo?.full_name !== repository ||
            current.head?.repo?.id !== current.base?.repo?.id ||
            current.base?.sha !== base || current.head?.sha !== head) {
            throw new Error('PR closed, moved, or is not from the same repository');
        }
    }

    const base = expectedBase || pull.base?.sha;
    const head = expectedHead || pull.head?.sha;
    if (!shaPattern.test(base) || !shaPattern.test(head)) {
        throw new Error('Invalid PR commit SHAs');
    }

    checkPull(pull, base, head);

    const count = pull.changed_files;
    if (!Number.isSafeInteger(count) || count < 0 || count > 3000) {
        throw new Error('PR changed-file count exceeds the 3,000-file API limit');
    }

    // The trusted preparation step diffs the merge base, not the base tip.
    if (!shaPattern.test(data.mergeBaseSha)) {
        throw new Error('Missing merge-base commit');
    }

    const files = data.files;
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

    if (files.length !== count) {
        throw new Error('PR file count does not match changed_files');
    }

    // The PR may have moved while its Git objects were being prepared.
    checkPull(data.after, base, head);
    // Fingerprint the complete listing so paginated responses can be verified as one consistent snapshot.
    const metadata = files.map(({ filename, previous_filename, status, additions, deletions, changes, oldMode, newMode }) =>
        ({ filename, previous_filename, status, additions, deletions, changes, oldMode, newMode }));
    const hash = value => createHash('sha256').update(value).digest('hex');
    const listingSha256 = hash(JSON.stringify(metadata));

    // Account for JSON escaping and the MCP envelope, not just raw patch bytes.
    const responseFits = value => Buffer.byteLength(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(value) }],
    })) <= 7000;
    if (mode === 'files') {
        if (filename !== undefined || position > count) {
            throw new Error('Invalid listing request');
        }
        const result = {
            baseSha: base, headSha: head, mergeBaseSha: data.mergeBaseSha, changedFiles: count, listingSha256,
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

    const file = files.find(entry => entry.filename === filename);
    if (!file || !scoped(file.filename) && !scoped(file.previous_filename)) {
        throw new Error('Diff request is outside the reviewed files');
    }

    if (file.binary || !['000000', '100644', '100755'].includes(file.oldMode) ||
        !['000000', '100644', '100755'].includes(file.newMode)) {
        throw new Error('Scoped file has an unsupported binary or object type');
    }
    if (file.changes && (typeof file.patch !== 'string' || !file.patch)) {
        throw new Error('Missing scoped Git patch');
    }
    if (!file.changes && file.status !== 'renamed' && file.status !== 'copied' &&
        file.oldMode === file.newMode) {
        throw new Error('Cannot establish a diff for a changed file');
    }

    const patch = file.patch || '';
    if (Buffer.byteLength(patch) !== file.patchBytes || hash(patch) !== file.patchSha256) {
        throw new Error('Scoped Git patch differs from the staged checksum');
    }
    let additions = 0;
    let deletions = 0;
    let oldRemaining = 0;
    let newRemaining = 0;
    let hunks = 0;
    // GitHub may omit patch text; hunk lengths and change counts expose truncation.
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
            if (line.startsWith('+')) { additions++; newRemaining--; }
            else if (line.startsWith('-')) { deletions++; oldRemaining--; }
            else if (line.startsWith(' ')) { oldRemaining--; newRemaining--; }
            else {
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
    const bytes = Buffer.from(patch, 'utf8');
    // Cursor offsets are bytes, but each returned chunk must end on a character.
    if (position > bytes.length || position < bytes.length && (bytes[position] & 0xc0) === 0x80) {
        throw new Error('Diff cursor is not a UTF-8 character boundary');
    }
    let end = Math.min(position + 5500, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) { end--; }
    const result = {
        baseSha: base, headSha: head, mergeBaseSha: data.mergeBaseSha,
        filename, previousFilename: file.previous_filename,
        status: file.status, oldMode: file.oldMode, newMode: file.newMode,
        offset: position, totalBytes: bytes.length, sha256: hash(bytes),
        chunk: bytes.subarray(position, end).toString('utf8'), nextCursor: end, complete: end === bytes.length,
    };
    while (!responseFits(result) && end > position) {
        end -= 256;
        while (end > position && (bytes[end] & 0xc0) === 0x80) { end--; }
        result.chunk = bytes.subarray(position, end).toString('utf8');
        result.nextCursor = end;
        result.complete = end === bytes.length;
    }
    if (end === position && position < bytes.length) {
        throw new Error('Diff chunk exceeds the response limit');
    }
    return result;
}

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
