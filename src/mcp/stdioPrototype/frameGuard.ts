/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Transform, type TransformCallback } from 'node:stream';
import { maxFrameBytes } from './connection';

export class FrameGuard extends Transform {
    private pending: Buffer = Buffer.alloc(0);
    private readonly decoder = new TextDecoder('utf-8', { fatal: true });

    // eslint-disable-next-line @typescript-eslint/naming-convention
    override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        let start = 0;
        try {
            for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
                const length = this.pending.length + end - start;
                if (length > maxFrameBytes) {
                    throw new Error('Oversized MCP frame.');
                }
                const line = Buffer.concat([this.pending, chunk.subarray(start, end)]);
                // SDK 2.0.0-beta.4 silently drops SyntaxError; reject it before the protocol parser.
                JSON.parse(this.decoder.decode(line));
                this.push(Buffer.concat([line, Buffer.from('\n')]));
                this.pending = Buffer.alloc(0);
                start = end + 1;
            }
            if (this.pending.length + chunk.length - start > maxFrameBytes) {
                throw new Error('Oversized MCP frame.');
            }
            this.pending = Buffer.concat([this.pending, chunk.subarray(start)]);
            callback();
        } catch {
            callback(new Error('Invalid or oversized MCP frame.'));
        }
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    override _flush(callback: TransformCallback): void {
        callback(this.pending.length ? new Error('Truncated MCP frame.') : undefined);
    }
}
