/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One running app per workspace, shared by every runtime gate, and released deterministically.
 *
 * Each gate asks a different question of the *same* running process, so starting the app
 * once and probing it many times is the natural shape. It is also the only shape that
 * works: grader certification runs a fixture's validators concurrently, and five gates
 * each starting their own copy would race for the same port and manufacture failures that
 * say nothing about the product.
 *
 * The cache stores the in-flight promise, so concurrent callers share one start rather than
 * five. `releaseRuntimeSessions` is the counterpart, and calling it is not optional: the
 * certification harness deletes the temporary fixture directory immediately afterwards, and
 * deleting a directory out from under a running server is how a machine acquires a
 * mysterious orphan.
 */

import type { NotApplicableReason, RuntimeTarget } from './runtimeTarget.ts';
import { resolveRuntimeTarget } from './runtimeTarget.ts';
import { startApp, waitForPortRelease, type RunningApp } from './appProcess.ts';

export type RuntimeSession =
    | { kind: 'started'; app: RunningApp; target: RuntimeTarget }
    | { kind: 'notApplicable'; reason: NotApplicableReason; detail: string }
    | { kind: 'harnessFault'; message: string; output: string }
    | { kind: 'productFailure'; code: string; message: string; output: string };

const sessions = new Map<string, Promise<RuntimeSession>>();

/** Start the workspace's app, or return the start already in progress for it. */
export function acquireRuntimeSession(workspaceRoot: string): Promise<RuntimeSession> {
    const existing = sessions.get(workspaceRoot);
    if (existing) {
        return existing;
    }
    const started = openSession(workspaceRoot);
    sessions.set(workspaceRoot, started);
    return started;
}

async function openSession(workspaceRoot: string): Promise<RuntimeSession> {
    const resolution = await resolveRuntimeTarget(workspaceRoot);
    if (resolution.kind === 'notApplicable') {
        return { kind: 'notApplicable', reason: resolution.reason, detail: resolution.detail };
    }
    if (resolution.kind === 'noApplication') {
        // The blame call the resolver deliberately declined to make. Planning artifacts in
        // the tree prove the agent worked here, so "no application" means it shipped none —
        // a product failure, and one that must not hide behind a not-applicable verdict.
        // Without them, the likelier story is that EVALUATE_WORKSPACE points somewhere else,
        // and blaming the agent for our own misconfiguration is the error that poisons the
        // corpus invisibly.
        return resolution.workspaceLooksStaged
            ? {
                kind: 'productFailure',
                code: 'noApplicationScaffolded',
                message: `${resolution.detail} The workspace does contain .azure planning artifacts, so the agent worked here and produced no runnable application.`,
                output: '',
            }
            : {
                kind: 'harnessFault',
                message: `${resolution.detail} There are no .azure planning artifacts either, so this is more likely the wrong directory than an empty scaffold — check EVALUATE_WORKSPACE.`,
                output: '',
            };
    }
    if (resolution.kind === 'harnessFault') {
        return { kind: 'harnessFault', message: resolution.message, output: '' };
    }

    const target = resolution.target;
    // An uninstalled project cannot start, but that is not evidence the agent produced a
    // broken app — it is evidence this gate ran before the build gate. Blaming the product
    // for it would be a fabricated failure, so it is a harness fault with a fix in the text.
    if (target.declaresDependencies && !target.dependenciesInstalled) {
        return {
            kind: 'harnessFault',
            message: `${target.packageDirectory} declares dependencies but has no node_modules, so the app cannot start. `
                + 'Run validate-project-builds (or npm install) before the runtime gates.',
            output: '',
        };
    }

    // A stack declaring `project.api: none` is a background worker: asserting it listens
    // would be a false red on an app behaving exactly as designed, so assert it stays alive.
    const outcome = await startApp(target, { expect: target.apiKind === 'none' ? 'alive' : 'listening' });
    if (outcome.kind === 'started') {
        return { kind: 'started', app: outcome.app, target };
    }
    return outcome;
}

/**
 * Stop every app this process started and confirm its port came back.
 *
 * A port still accepting connections after the child is reaped means something escaped the
 * process-group kill. That is reported loudly here rather than left for the next run to
 * discover as an unexplained "port already in use".
 */
export async function releaseRuntimeSessions(): Promise<void> {
    const pending = [...sessions.values()];
    sessions.clear();
    for (const entry of pending) {
        let session: RuntimeSession;
        try {
            session = await entry;
        } catch {
            continue;
        }
        if (session.kind !== 'started') {
            continue;
        }
        await session.app.stop();
        // A worker holds no port, so there is nothing to wait for its release.
        if (session.app.port !== undefined && !await waitForPortRelease(session.app.port)) {
            process.stderr.write(
                `[runtime] WARNING: port ${session.app.port} is still accepting connections after teardown. `
                + 'A process escaped the group kill and will break later runs on this machine.\n');
        }
    }
}

export interface HttpProbeResponse {
    status: number;
    body: string;
    contentType: string;
}

export type HttpProbeResult =
    | { ok: true; response: HttpProbeResponse }
    | { ok: false; error: string };

/** Bound every request, so a hung server costs seconds rather than the whole run. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long to keep retrying a *connection-level* failure. A socket can be refused for a
 * moment after the port opens, so a single refusal is not an answer. Retries are strictly
 * limited to transport errors: retrying an HTTP status would paper over the 500 that gate 2
 * exists to catch.
 */
const CONNECTION_RETRY_WINDOW_MS = 5_000;

export async function probe(url: string, init: RequestInit = {}): Promise<HttpProbeResult> {
    const deadline = Date.now() + CONNECTION_RETRY_WINDOW_MS;
    let lastError = 'unknown error';
    for (;;) {
        try {
            const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            return {
                ok: true,
                response: {
                    status: response.status,
                    body: await response.text(),
                    contentType: response.headers.get('content-type') ?? '',
                },
            };
        } catch (error) {
            lastError = describeFetchError(error);
            if (Date.now() >= deadline) {
                return { ok: false, error: lastError };
            }
            await sleep(200);
        }
    }
}

function describeFetchError(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        return cause?.code ? `${error.message} (${cause.code})` : error.message;
    }
    return String(error);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
