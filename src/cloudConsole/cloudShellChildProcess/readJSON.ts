/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

// file is imported by cloudConsoleLauncher.ts, which is run as a child process from the extension host and communicates via IPC
// do not add any VS Code related dependencies to this file, as it is not run in the extension host
import * as http from 'http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJSON<T>(req: http.IncomingMessage): Promise<any> {
    return new Promise<T>((resolve, reject) => {
        const chunks: string[] = [];
        req.setEncoding('utf8');
        req.on('data', (d: string) => chunks.push(d));
        req.on('error', (err: Error) => reject(err));
        req.on('end', () => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const data = JSON.parse(chunks.join(''));
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            resolve(data);
        });
    });
}

