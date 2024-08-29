/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as crypto from 'crypto';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { ext } from '../extensionVariables';

export async function createServer(ipcHandlePrefix: string, onRequest: http.RequestListener): Promise<Server> {

    async function randomBytes(size: number) {
        return new Promise<Buffer>((resolve, reject) => {
            crypto.randomBytes(size, (err, buf) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(buf);
                }
            });
        });
    }

    // create a nonce out of 20 random bytes
    const buffer = await randomBytes(20);
    const nonce = buffer.toString('hex');

    const ipcHandlePath = getIPCHandlePath(`${ipcHandlePrefix}-${nonce}`);
    const server = new Server(ipcHandlePath, onRequest);
    server.listen();
    return server;
}

// Http server listens to a named pipe or a Unix socket unlike a typical http server
export class Server {

    public server: http.Server;

    constructor(public ipcHandlePath: string, onRequest: http.RequestListener) {
        this.server = http.createServer((req, res) => {
            Promise.resolve(onRequest(req, res))
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                .catch((err) => console.error(err && err.message || err));
        });
        this.server.on('error', err => console.error(err));
    }

    listen(): void {
        this.server.listen(this.ipcHandlePath);
    }

    dispose(): void {
        this.server.close(error => error && error.message && ext.outputChannel.error(error.message));
    }
}

/**
 * Returns the path for the IPC handle based on the given ID.
 * On Windows, it returns a named pipe path. On Unix-like systems, it returns a socket path.
 * If the XDG_RUNTIME_DIR environment variable is set, it uses that directory for the socket path.
 * Otherwise, it uses the temporary directory.
 */
function getIPCHandlePath(id: string): string {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\${id}-sock`;
    }

    // XDG_RUNTIME_DIR is a Unix specific directory where user-specific non-essential
    // runtime files and other file objects (such as sockets, named pipes, etc.) should be stored
    if (process.env['XDG_RUNTIME_DIR']) {
        return path.join(process.env['XDG_RUNTIME_DIR'], `${id}.sock`);
    }

    return path.join(os.tmpdir(), `${id}.sock`);
}

export class Queue<T> {

    private messages: T[] = [];
    private dequeueRequest?: {
        resolve: (value: T[]) => void;
        reject: (err: unknown) => void;
    };

    public push(message: T): void {
        this.messages.push(message);
        if (this.dequeueRequest) {
            this.dequeueRequest.resolve(this.messages);
            this.dequeueRequest = undefined;
            this.messages = [];
        }
    }

    public async dequeue(timeout?: number): Promise<T[]> {
        if (this.messages.length) {
            const messages = this.messages;
            this.messages = [];
            return messages;
        }
        if (this.dequeueRequest) {
            this.dequeueRequest.resolve([]);
        }
        return new Promise<T[]>((resolve, reject) => {
            this.dequeueRequest = { resolve, reject };
            if (typeof timeout === 'number') {
                setTimeout(reject, timeout);
            }
        });
    }
}
