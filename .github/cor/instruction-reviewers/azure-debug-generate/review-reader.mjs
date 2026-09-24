import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const PAGE_SIZE = 50;
const CHUNK_SIZE = 8192;
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createReader(bundle) {
    if (!Array.isArray(bundle.files) || !Array.isArray(bundle.scopedFiles) ||
        bundle.files.length !== bundle.changedCount ||
        bundle.scopedFiles.some(file => !bundle.files[file.index] ||
            bundle.files[file.index].filename !== file.filename || typeof file.patch !== 'string')) {
        throw new Error('Invalid staged review bundle');
    }
    const tools = [
        {
            name: 'review_manifest',
            description: 'Read pinned PR identity and a page of the complete, verified Git file listing.',
            inputSchema: {
                type: 'object', properties: { offset: { type: 'integer', minimum: 0 } },
                required: ['offset'], additionalProperties: false,
            },
        },
        {
            name: 'review_chunk',
            description: 'Read an 8 KiB UTF-8 patch or full proposed file chunk by Git listing index and byte offset.',
            inputSchema: {
                type: 'object',
                properties: {
                    index: { type: 'integer', minimum: 0 },
                    kind: { type: 'string', enum: ['patch', 'head'] },
                    offset: { type: 'integer', minimum: 0 },
                },
                required: ['index', 'kind', 'offset'], additionalProperties: false,
            },
        },
    ];
    function call(name, args) {
        if (name === 'review_manifest') {
            const { offset } = args;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > bundle.files.length) {
                throw new Error('Invalid manifest offset');
            }
            const files = [];
            for (const file of bundle.files.slice(offset, offset + PAGE_SIZE)) {
                if (Buffer.byteLength(JSON.stringify([...files, file])) > CHUNK_SIZE) {
                    break;
                }
                files.push(file);
            }
            if (offset < bundle.files.length && files.length === 0) {
                throw new Error('File metadata exceeds page limit');
            }
            return {
                pullNumber: bundle.pullNumber, base: bundle.base, head: bundle.head,
                mergeBase: bundle.mergeBase, changedCount: bundle.changedCount,
                scopedCount: bundle.scopedFiles.length,
                files, nextOffset: offset + files.length,
            };
        }
        if (name === 'review_chunk') {
            const { index, kind, offset } = args;
            const file = bundle.scopedFiles.find(entry => entry.index === index);
            if (!file || !['patch', 'head'].includes(kind) || (kind === 'head' && file.headText === null) ||
                !Number.isSafeInteger(offset) || offset < 0) {
                throw new Error('Invalid scoped file, kind, or offset');
            }
            const bytes = Buffer.from(kind === 'patch' ? file.patch : file.headText, 'utf8');
            if (offset > bytes.length) {
                throw new Error('Offset exceeds file size');
            }
            let end = Math.min(offset + CHUNK_SIZE, bytes.length);
            let chunk;
            if (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) {
                throw new Error('Offset splits a UTF-8 character');
            }
            while (end > offset) {
                try {
                    chunk = decoder.decode(bytes.subarray(offset, end));
                    break;
                } catch {
                    end--;
                }
            }
            if (chunk === undefined) {
                throw new Error('Unable to read UTF-8 chunk');
            }
            return { index, kind, filename: file.filename, offset, nextOffset: end,
                totalBytes: bytes.length, text: chunk };
        }
        throw new Error(`Unknown review tool: ${name}`);
    }
    return { tools, call };
}

export function serve(reader, input, output) {
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on('line', line => {
        let message;
        try {
            message = JSON.parse(line);
            if (!Object.hasOwn(message, 'id')) {
                return;
            }
            let result;
            switch (message.method) {
                case 'initialize':
                    result = { protocolVersion: '2025-06-18',
                        capabilities: { tools: {} }, serverInfo: { name: 'staged-review', version: '1.0.0' } };
                    break;
                case 'ping':
                    result = {};
                    break;
                case 'tools/list':
                    result = { tools: reader.tools };
                    break;
                case 'tools/call':
                    try {
                        result = { content: [{ type: 'text',
                            text: JSON.stringify(reader.call(message.params?.name, message.params?.arguments ?? {})) }] };
                    } catch (error) {
                        result = { isError: true, content: [{ type: 'text', text: error.message }] };
                    }
                    break;
                default:
                    throw new Error(`Unsupported MCP method: ${message.method}`);
            }
            output.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
        } catch (error) {
            output.write(`${JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null,
                error: { code: -32600, message: error.message } })}\n`);
        }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const bundle = JSON.parse(readFileSync(join(process.env.REVIEW_BUNDLE_DIR, 'bundle.json'), 'utf8'));
    serve(createReader(bundle), process.stdin, process.stdout);
}
