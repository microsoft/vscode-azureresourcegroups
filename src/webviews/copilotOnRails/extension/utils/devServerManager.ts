/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";

/**
 * A running frontend dev server. `url` is the localhost URL the server bound to
 * (as printed by the dev tool, e.g. Vite's `Local: http://localhost:5173/`).
 * Call `dispose()` to terminate the whole process tree.
 */
export interface RunningDevServer {
    readonly url: string;
    dispose(): void;
}

/**
 * Matches the first loopback dev-server URL a tool prints, e.g. Vite's
 * `Local: http://localhost:5173/`. The host is captured so unroutable bind
 * addresses (`0.0.0.0`, `[::]`) can be normalized to `localhost` for the
 * iframe / external open.
 *
 * The port is **required** and must be followed by a `/` or whitespace.
 * Dev-server stdout arrives in arbitrary chunks, so a URL like
 * `http://localhost:5173/` can be split across reads (e.g. `http://localhost`
 * then `:5173/`, or `:51` then `73/`). An optional/unterminated port would let
 * us latch onto a portless or truncated-port URL — which then renders as a
 * blank iframe and makes "open in browser" hit the wrong address. Requiring a
 * trailing terminator guarantees the port digits are complete before we accept
 * the URL (the dev tool always prints a newline after the URL line, so the
 * terminator arrives in the accumulated buffer even if it lands in a later
 * chunk). Some tools bind to `0.0.0.0`/`[::]`, which we treat as loopback.
 */
const localUrlRegex = /(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)(?=[/\s])/i;

/** Strips ANSI escape sequences so color codes can't break URL detection. */
// eslint-disable-next-line no-control-regex
const ansiRegex = /\x1B\[[0-9;]*[A-Za-z]/g;

/** Hosts that can't be loaded directly — remap to `localhost` for the webview. */
const unroutableHosts = new Set(['0.0.0.0', '[::]']);

/**
 * Extract the first usable loopback URL from accumulated dev-server output.
 * Returns `undefined` until a complete `host:port` URL has been printed.
 */
function extractLocalUrl(output: string): string | undefined {
    const match = localUrlRegex.exec(output.replace(ansiRegex, ''));
    if (!match) {
        return undefined;
    }
    const [, scheme, host, port] = match;
    const normalizedHost = unroutableHosts.has(host.toLowerCase()) ? 'localhost' : host;
    return `${scheme}${normalizedHost}:${port}`;
}

/**
 * Detect the package manager for `folder` by lockfile. Falls back to npm.
 */
function detectPackageManager(folder: string): 'npm' | 'pnpm' | 'yarn' {
    if (fs.existsSync(path.join(folder, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(folder, 'yarn.lock'))) {
        return 'yarn';
    }
    return 'npm';
}

/**
 * Read the frontend's `package.json` and pick the dev script. Prefers `dev`,
 * then `start`. Returns `undefined` when neither exists.
 */
function detectDevScript(folder: string): string | undefined {
    try {
        const pkgRaw = fs.readFileSync(path.join(folder, 'package.json'), 'utf-8');
        const scripts = (JSON.parse(pkgRaw) as { scripts?: Record<string, string> }).scripts ?? {};
        if (scripts.dev) {
            return 'dev';
        }
        if (scripts.start) {
            return 'start';
        }
    } catch {
        // Missing/unparseable package.json — handled by the caller.
    }
    return undefined;
}

/**
 * Terminate the dev-server process tree. The dev script is launched through a
 * shell (and through the package manager), so a plain `child.kill()` only
 * reaps the wrapper and leaves the actual server (node/vite) listening on the
 * port. We kill the whole tree: `taskkill /T` on Windows, the process group on
 * POSIX (the child is spawned `detached` so it leads its own group).
 */
function killTree(child: ChildProcess): void {
    if (child.pid === undefined || child.exitCode !== null || child.killed) {
        return;
    }
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            // Negative pid → signal the entire process group.
            process.kill(-child.pid, 'SIGTERM');
        }
    } catch {
        // Process already gone — nothing to clean up.
        try {
            child.kill('SIGKILL');
        } catch {
            // ignore
        }
    }
}

/**
 * Start the frontend dev server in `folder` and resolve once it reports the
 * local URL it bound to. Rejects on timeout or if the process exits before a
 * URL is seen.
 *
 * @param folder Absolute path to the frontend project (contains `package.json`).
 * @param timeoutMs How long to wait for the server to announce its URL.
 */
export async function startDevServer(folder: string, timeoutMs = 90_000): Promise<RunningDevServer> {
    const script = detectDevScript(folder);
    if (!script) {
        throw new Error(vscode.l10n.t('No "dev" or "start" script found in {0}/package.json.', vscode.workspace.asRelativePath(folder)));
    }

    const pm = detectPackageManager(folder);
    // `shell: true` lets the OS resolve the package-manager binary (e.g. the
    // `npm.cmd` shim on Windows) without us hard-coding extensions.
    const child = spawn(pm, ['run', script], {
        cwd: folder,
        shell: true,
        // Lead our own process group on POSIX so killTree can reap children.
        detached: process.platform !== 'win32',
        // eslint-disable-next-line @typescript-eslint/naming-convention -- these are environment variable names
        env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' },
    });

    let server: RunningDevServer | undefined;

    return await new Promise<RunningDevServer>((resolve, reject) => {
        let settled = false;
        const buffered: string[] = [];

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                killTree(child);
                reject(new Error(vscode.l10n.t('The frontend dev server did not report a URL within {0}s.', Math.round(timeoutMs / 1000))));
            }
        }, timeoutMs);

        const dispose = (): void => {
            clearTimeout(timer);
            killTree(child);
        };

        const onChunk = (chunk: Buffer): void => {
            const text = chunk.toString();
            buffered.push(text);
            ext.outputChannel.appendLog(`[FrontendPreview] ${text.trimEnd()}`);
            if (settled) {
                return;
            }
            // Match against the accumulated output, not just this chunk, so a
            // URL whose port digits are split across reads is detected once the
            // full `:PORT/` has arrived.
            const url = extractLocalUrl(buffered.join(''));
            if (url) {
                settled = true;
                clearTimeout(timer);
                server = { url, dispose };
                resolve(server);
            }
        };

        child.stdout?.on('data', onChunk);
        child.stderr?.on('data', onChunk);

        child.on('error', (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });

        child.on('exit', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                const tail = buffered.join('').trim().split('\n').slice(-5).join('\n');
                reject(new Error(vscode.l10n.t('The frontend dev server exited (code {0}) before reporting a URL.\n{1}', code ?? 'null', tail)));
            }
        });
    });
}
