/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This file is run as a child process from the extension host and communicates via IPC to the extension host.
// It connects to Azure Cloud Shell via websocket and writes and reads data from the websocket in order to
// interact with the remote shell. Calls to `console` show up in the VS Code terminal.
//
// Note: Do not add any VS Code related dependencies to this file, as it is not run in the extension host.
import * as http from 'http';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as request from 'request-promise';
import * as WS from 'ws';
import { readJSON } from './readJSON';

function delay<T = void>(ms: number, result?: T | PromiseLike<T>): Promise<T | PromiseLike<T> | undefined> {
    return new Promise(resolve => setTimeout(() => resolve(result), ms));
}

export interface AccessTokens {
    resource: string;
    graph: string;
    keyVault?: string;
}

export interface ConsoleUris {
    consoleUri: string;
    terminalUri: string;
    socketUri: string;
}

export interface Size {
    cols: number;
    rows: number;
}

function getWindowSize(): Size {
    const stdout = process.stdout;
    const windowSize: [number, number] = stdout.isTTY ? stdout.getWindowSize() : [80, 30];
    return {
        cols: windowSize[0],
        rows: windowSize[1],
    };
}

let resizeToken = {};
async function resize(accessToken: string, terminalUri: string) {
    const token = resizeToken = {};
    await delay(300);

    for (let i = 0; i < 10; i++) {
        if (token !== resizeToken) {
            return;
        }

        const { cols, rows } = getWindowSize();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response = await request({
            uri: `${terminalUri}/size?cols=${cols}&rows=${rows}`,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            simple: false,
            resolveWithFullResponse: true,
            json: true,
            // Provide empty body so that 'Content-Type' header is set properly
            body: {}
        });

        /* eslint-disable @typescript-eslint/no-unsafe-member-access */
        if (response.statusCode < 200 || response.statusCode > 299) {
            if (response.statusCode !== 503 && response.statusCode !== 504 && response.body && response.body.error) {
                if (response.body && response.body.error && response.body.error.message) {
                    console.log(`${response.body.error.message} (${response.statusCode})`);
                } else {
                    console.log(response.statusCode, response.headers, response.body);
                }
                break;
            }
            await delay(1000 * (i + 1));
            continue;
        }
        /* eslint-enable @typescript-eslint/no-unsafe-member-access */

        return;
    }

    console.log('Failed to resize terminal.');
}

// child process sends data to the extension host via POST requests to the IPC server running in the extension host
async function sendData(socketPath: string, data: string): Promise<http.IncomingMessage> {
    return new Promise<http.IncomingMessage>((resolve, reject) => {
        const opts: http.RequestOptions = {
            socketPath,
            path: '/',
            method: 'POST'
        };

        const req = http.request(opts, res => resolve(res));
        req.on('error', (err: Error) => reject(err));
        req.write(data);
        req.end();
    });
}

// Connects to Azure Cloud Shell via websocket. Writes and reads data from the websocket in order to interact with the remote shell.
function connectSocket(ipcHandle: string, url: string) {

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined;
    let agent: http.Agent | undefined = undefined;
    if (proxy) {
        agent = url.startsWith('ws:') || url.startsWith('http:') ? new HttpProxyAgent(proxy) : new HttpsProxyAgent(proxy);
    }

    const ws = new WS(url, {
        agent
    });

    ws.on('open', function () {
        process.stdin.on('data', function (data) {
            ws.send(data);
        });
        startKeepAlive();
        sendData(ipcHandle, JSON.stringify([{ type: 'status', status: 'Connected' }]))
            .catch(err => {
                console.error(err);
            });
    });

    // When we get data from cloud shell, write it to stdout. In this case stdout is the VS Code terminal.
    ws.on('message', function (data) {
        process.stdout.write(String(data));
    });

    let error = false;
    ws.on('error', function (event) {
        error = true;
        console.error('Socket error: ' + JSON.stringify(event));
    });

    ws.on('close', function () {
        console.log('Socket closed');
        sendData(ipcHandle, JSON.stringify([{ type: 'status', status: 'Disconnected' }]))
            .catch(err => {
                console.error(err);
            });
        if (!error) {
            process.exit(0);
        }
    });

    function startKeepAlive() {
        let isAlive = true;
        ws.on('pong', () => {
            isAlive = true;
        });
        const timer = setInterval(() => {
            if (isAlive === false) {
                error = true;
                console.log('Socket timeout');
                ws.terminate();
                clearInterval(timer);
            } else {
                isAlive = false;
                ws.ping();
            }
        }, 60000);
        timer.unref();
    }
}

export function main() {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // process.env.CLOUD_CONSOLE_IPC is defined when the extension host creates the terminal
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ipcHandle = process.env.CLOUD_CONSOLE_IPC!;
    (async () => {
        void sendData(ipcHandle, JSON.stringify([{ type: 'size', size: getWindowSize() }]));
        let res: http.IncomingMessage;
        // eslint-disable-next-line no-cond-assign
        while (res = await sendData(ipcHandle, JSON.stringify([{ type: 'poll' }]))) {
            for (const message of await readJSON(res)) {
                /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
                if (message.type === 'log') {
                    console.log(...(message.args) as []);
                } else if (message.type === 'connect') {
                    try {
                        const accessToken: string = message.accessToken;
                        const consoleUris: ConsoleUris = message.consoleUris;
                        connectSocket(ipcHandle, consoleUris.socketUri);
                        process.stdout.on('resize', () => {
                            resize(accessToken, consoleUris.terminalUri)
                                .catch(console.error);
                        });
                    } catch (err) {
                        console.error(err);
                        sendData(ipcHandle, JSON.stringify([{ type: 'status', status: 'Disconnected' }]))
                            .catch(err => {
                                console.error(err);
                            });
                    }
                } else if (message.type === 'exit') {
                    process.exit(message.code as number);
                }
            }
        }
    })()
        .catch(console.error);
}
