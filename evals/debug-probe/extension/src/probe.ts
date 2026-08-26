/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The probe itself: resolve a breakpoint by pattern, launch the project's own
 * launch configuration, drive execution to the breakpoint, and record what
 * happened precisely enough that the grader can attribute the result.
 *
 * Four things in here are counter-intuitive and each one was learned by running
 * it rather than by reading the API docs. They are marked WHY in place:
 *   1. function breakpoints are unusable on Node, so we resolve a line ourselves
 *   2. `verified: false` is normal on a breakpoint that is about to be hit
 *   3. the trigger request never completes on a healthy run
 *   4. only a `DebugAdapterTracker` sees the `stopped` event reliably
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as vscode from 'vscode';
import type {
    AdapterObservation,
    BreakpointResolution,
    DebugProbeVerdict,
    ProbeOutcome,
    ProbeSpec,
    StoppedObservation,
} from './verdict';
import { PROBE_SCHEMA_VERSION } from './verdict';

const DEFAULT_TIMEOUT_MS = 120_000;
const TRIGGER_ATTEMPT_TIMEOUT_MS = 2_000;
const TRIGGER_RETRY_DELAY_MS = 500;
const MAX_GLOB_FILES_RECORDED = 25;

export interface ProbeContext {
    folder: vscode.WorkspaceFolder;
    spec: ProbeSpec;
    /** Disposables the caller owns; the tracker registration is pushed here. */
    subscriptions: vscode.Disposable[];
}

export class Recorder {
    public readonly timeline: string[] = [];
    public readonly output: string[] = [];

    public log(message: string): void {
        this.timeline.push(`${new Date().toISOString()} ${message}`);
        console.log(`[cor-debug-probe] ${message}`);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; settled: () => boolean } {
    let resolveFn!: (value: T) => void;
    let done = false;
    const promise = new Promise<T>(resolve => {
        resolveFn = (value: T) => { done = true; resolve(value); };
    });
    return { promise, resolve: resolveFn, settled: () => done };
}

/**
 * Resolve the breakpoint location by glob + regex.
 *
 * WHY not a function breakpoint: js-debug reports `supportsFunctionBreakpoints: false`
 * and does not implement `setFunctionBreakpoints` at all. Worse, VS Code's debug
 * service guards the send on that capability, so a `vscode.FunctionBreakpoint` is
 * silently discarded with no error surfaced to the extension. A probe built on it
 * would report "never hit" on every run forever.
 *
 * Records enough about the attempt that a miss can be re-adjudicated later without
 * re-running: a glob that matched no files is a different claim from a glob that
 * matched files none of whose lines matched the regex.
 */
export async function resolveBreakpoint(
    folder: vscode.WorkspaceFolder,
    spec: ProbeSpec,
    recorder: Recorder,
): Promise<BreakpointResolution> {
    const relativePattern = new vscode.RelativePattern(folder, spec.breakpoint.glob);
    const found = await vscode.workspace.findFiles(relativePattern, '**/node_modules/**');
    const sorted = [...found].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const toRelative = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false);

    const resolution: BreakpointResolution = {
        glob: spec.breakpoint.glob,
        pattern: spec.breakpoint.pattern,
        filesMatchedByGlob: sorted.slice(0, MAX_GLOB_FILES_RECORDED).map(toRelative),
        globMatchCount: sorted.length,
    };
    recorder.log(`glob ${spec.breakpoint.glob} matched ${sorted.length} file(s)`);

    const regex = new RegExp(spec.breakpoint.pattern);
    for (const uri of sorted) {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const lines = text.split(/\r?\n/);
        const index = lines.findIndex(line => regex.test(line));
        if (index >= 0) {
            resolution.match = { file: toRelative(uri), line: index + 1, text: lines[index] };
            recorder.log(`resolved ${resolution.match.file}:${resolution.match.line}`);
            return resolution;
        }
    }
    recorder.log(`pattern /${spec.breakpoint.pattern}/ matched no line in any globbed file`);
    return resolution;
}

/**
 * Fire the trigger until something accepts a connection.
 *
 * WHY "connected" rather than "responded": on a healthy run the breakpoint stops
 * the process mid-request, so the HTTP response never arrives. Awaiting the
 * response would time out against a perfectly working app and be reported as
 * `appFailedToStart`. Connection established is the only honest signal, and we
 * stop early the moment the debuggee actually stops.
 */
async function triggerUntilConnected(
    url: string,
    deadline: number,
    stopped: () => boolean,
    recorder: Recorder,
): Promise<boolean> {
    const request = url.startsWith('https:') ? https.get : http.get;
    let attempts = 0;
    while (Date.now() < deadline && !stopped()) {
        attempts++;
        const connected = await new Promise<boolean>(resolve => {
            let settled = false;
            const finish = (value: boolean) => { if (!settled) { settled = true; resolve(value); } };
            const clientRequest = request(url, () => finish(true));
            clientRequest.on('socket', socket => socket.on('connect', () => finish(true)));
            clientRequest.on('error', () => finish(false));
            setTimeout(() => { clientRequest.destroy(); finish(false); }, TRIGGER_ATTEMPT_TIMEOUT_MS);
        });
        if (connected) {
            recorder.log(`trigger connected after ${attempts} attempt(s)`);
            return true;
        }
        await delay(TRIGGER_RETRY_DELAY_MS);
    }
    recorder.log(`trigger never connected after ${attempts} attempt(s)`);
    return false;
}

/** Read the top frame and its locals. Evidence that the stop was real, not just an event. */
async function readStack(session: vscode.DebugSession, threadId: number, recorder: Recorder): Promise<Partial<StoppedObservation>> {
    try {
        const stack = await session.customRequest('stackTrace', { threadId, levels: 1 }) as {
            stackFrames?: { id: number; name: string; line: number; source?: { path?: string } }[];
        };
        const frame = stack.stackFrames?.[0];
        if (!frame) {
            return {};
        }
        const scopes = await session.customRequest('scopes', { frameId: frame.id }) as {
            scopes?: { name: string; variablesReference: number; presentationHint?: string }[];
        };
        const localScope = scopes.scopes?.find(scope => scope.presentationHint === 'locals') ?? scopes.scopes?.[0];
        const locals: Record<string, string> = {};
        if (localScope) {
            const variables = await session.customRequest('variables', { variablesReference: localScope.variablesReference }) as {
                variables?: { name: string; value: string }[];
            };
            for (const variable of variables.variables ?? []) {
                locals[variable.name] = variable.value;
            }
        }
        return { frame: frame.name, file: frame.source?.path, line: frame.line, locals };
    } catch (error) {
        // Losing the stack detail does not change the verdict — the stop already
        // happened — so degrade rather than turning a genuine pass into a fault.
        recorder.log(`could not read stack: ${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}

export async function runProbe(context: ProbeContext, recorder: Recorder): Promise<DebugProbeVerdict> {
    const { folder, spec } = context;
    const startedAt = Date.now();
    const deadline = startedAt + (spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const adapter: AdapterObservation = { setBreakpoints: [] };

    const finish = (outcome: ProbeOutcome, detail: string, extra: Partial<DebugProbeVerdict> = {}): DebugProbeVerdict => ({
        schemaVersion: PROBE_SCHEMA_VERSION,
        outcome,
        detail,
        spec,
        timeline: recorder.timeline,
        output: recorder.output,
        durationMs: Date.now() - startedAt,
        ...extra,
    });

    // ---- 1. The launch configuration must exist and name the requested config ----------
    // getConfiguration parses launch.json for us, comments and trailing commas included.
    const configurations = vscode.workspace
        .getConfiguration('launch', folder.uri)
        .get<{ name?: string }[]>('configurations') ?? [];
    const names = configurations.map(configuration => configuration.name).filter((name): name is string => typeof name === 'string');
    recorder.log(`launch configurations: ${JSON.stringify(names)}`);

    if (configurations.length === 0) {
        return finish('launchConfigInvalid', 'launch.json is missing or declares no configurations');
    }
    if (!names.includes(spec.launchConfig)) {
        return finish('launchConfigInvalid', `no launch configuration named "${spec.launchConfig}"; found: ${names.join(', ') || '(none named)'}`);
    }

    // ---- 2. Place the breakpoint by pattern -------------------------------------------
    const resolution = await resolveBreakpoint(folder, spec, recorder);
    if (!resolution.match) {
        const why = resolution.globMatchCount === 0
            ? `no file matched glob "${resolution.glob}"`
            : `glob "${resolution.glob}" matched ${resolution.globMatchCount} file(s) but no line matched /${resolution.pattern}/`;
        return finish('patternMatchedNothing', `could not place a breakpoint: ${why}`, { resolution });
    }

    const uri = vscode.Uri.joinPath(folder.uri, resolution.match.file);
    const location = new vscode.Location(uri, new vscode.Position(resolution.match.line - 1, 0));
    const breakpoint = new vscode.SourceBreakpoint(location, true);
    vscode.debug.addBreakpoints([breakpoint]);

    // ---- 3. Watch the wire -------------------------------------------------------------
    // WHY a tracker: the public Breakpoint class exposes no `verified`, and the
    // `stopped` event is not surfaced as an extension API event at all.
    // onDidChangeActiveStackItem fires later, after the UI settles.
    const stoppedSignal = deferred<{ reason: string; threadId: number; session: vscode.DebugSession }>();
    const terminatedSignal = deferred<string>();

    context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
            return {
                onDidSendMessage: (message: { type?: string; event?: string; command?: string; body?: Record<string, unknown> }): void => {
                    if (message.type === 'response' && message.command === 'setBreakpoints') {
                        const breakpoints = (message.body?.breakpoints ?? []) as { verified?: boolean; line?: number; message?: string }[];
                        for (const entry of breakpoints) {
                            adapter.setBreakpoints.push({ verified: entry.verified, line: entry.line, message: entry.message });
                        }
                        recorder.log(`setBreakpoints response: ${JSON.stringify(breakpoints)}`);
                        return;
                    }
                    if (message.type === 'event' && message.event === 'output') {
                        const text = String(message.body?.output ?? '').trimEnd();
                        if (text) {
                            recorder.output.push(text);
                        }
                        return;
                    }
                    if (message.type === 'event' && message.event === 'stopped') {
                        const reason = String(message.body?.reason ?? '');
                        recorder.log(`stopped: reason=${reason} session=${session.name}`);
                        stoppedSignal.resolve({ reason, threadId: Number(message.body?.threadId ?? 0), session });
                        return;
                    }
                    if (message.type === 'event' && (message.event === 'terminated' || message.event === 'exited')) {
                        const detail = `${message.event} ${JSON.stringify(message.body ?? {})}`;
                        recorder.log(detail);
                        adapter.terminated = detail;
                        terminatedSignal.resolve(detail);
                    }
                },
                onError: (error: Error): void => recorder.log(`adapter error: ${error.message}`),
            };
        },
    }));

    // ---- 4. Launch ---------------------------------------------------------------------
    // `true` means "launch was initiated", NOT "the debuggee is running", so it can
    // only rule out a failure, never confirm success.
    //
    // Bounded, because `startDebugging` awaits the configuration's `preLaunchTask`
    // and a task that never completes would otherwise hang the probe indefinitely —
    // which MSBench would eventually kill as a stalled run and report against the
    // product with no verdict at all. A launch configuration whose own preLaunchTask
    // hangs is a genuine product failure: pressing F5 hangs for a user too.
    const launchOutcome = await Promise.race([
        vscode.debug.startDebugging(folder, spec.launchConfig),
        delay(Math.max(0, deadline - Date.now())).then(() => 'timedOut' as const),
    ]);
    if (launchOutcome === 'timedOut') {
        await stopDebugging(recorder);
        return finish('appFailedToStart', `startDebugging("${spec.launchConfig}") never resolved within the probe budget — an unfinishable preLaunchTask is the usual cause`, { resolution, adapter });
    }
    const started = launchOutcome;
    adapter.startDebuggingReturned = started;
    recorder.log(`startDebugging returned ${started}`);
    if (!started) {
        return finish('appFailedToStart', `startDebugging("${spec.launchConfig}") returned false`, { resolution, adapter });
    }

    // ---- 5. Drive execution to the breakpoint -------------------------------------------
    if (spec.trigger) {
        adapter.triggerConnected = await triggerUntilConnected(spec.trigger.url, deadline, stoppedSignal.settled, recorder);
    }

    // ---- 6. Wait for a stop, a termination, or the deadline ------------------------------
    const raced = await Promise.race([
        stoppedSignal.promise.then(value => ({ kind: 'stopped' as const, ...value })),
        terminatedSignal.promise.then(detail => ({ kind: 'terminated' as const, detail })),
        delay(Math.max(0, deadline - Date.now())).then(() => ({ kind: 'timeout' as const })),
    ]);

    const reachable = adapter.triggerConnected !== false;

    if (raced.kind === 'terminated') {
        await stopDebugging(recorder);
        return reachable
            ? finish('breakpointNotHit', `the app served the trigger but terminated without reaching ${resolution.match.file}:${resolution.match.line} (${raced.detail})`, { resolution, adapter })
            : finish('appFailedToStart', `the debuggee terminated before accepting a connection on ${spec.trigger?.url} (${raced.detail})`, { resolution, adapter });
    }

    if (raced.kind === 'timeout') {
        await stopDebugging(recorder);
        if (!reachable) {
            return finish('appFailedToStart', `nothing accepted a connection on ${spec.trigger?.url} within the probe budget`, { resolution, adapter });
        }
        return finish('breakpointNotHit', `the app was reachable but execution never reached ${resolution.match.file}:${resolution.match.line} within the probe budget`, { resolution, adapter });
    }

    if (raced.reason !== 'breakpoint') {
        await stopDebugging(recorder);
        return finish('breakpointNotHit', `execution stopped for "${raced.reason}" rather than "breakpoint"`, {
            resolution,
            adapter,
            stopped: { reason: raced.reason },
        });
    }

    // ---- 7. Capture the evidence --------------------------------------------------------
    const stopped: StoppedObservation = { reason: 'breakpoint', ...(await readStack(raced.session, raced.threadId, recorder)) };
    await stopDebugging(recorder);
    return finish('hit', `breakpoint hit at ${resolution.match.file}:${resolution.match.line}`, { resolution, adapter, stopped });
}

async function stopDebugging(recorder: Recorder): Promise<void> {
    try {
        await vscode.debug.stopDebugging();
    } catch (error) {
        recorder.log(`stopDebugging failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
