/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Start the generated application, wait until it is actually listening, and — whatever
 * happens next — make sure it is gone again.
 *
 * Every other gate in this repository reads files, and the build grader is only slightly
 * more than that: `npm run build` exits on its own. A server does not. That single
 * difference is what this module exists to handle, and it drives three rules:
 *
 *   1. **Teardown is a correctness requirement, not politeness.** A leaked process holds a
 *      port, and the next run on that machine then fails for a reason that has nothing to
 *      do with the product it is grading. So the child is spawned into its own process
 *      group and the *group* is signalled — `npm start` forks a shell which forks node, and
 *      killing only the pid we were handed leaves the grandchild holding the socket.
 *      Cleanup runs from a `finally`, and a process-level net catches the paths a `finally`
 *      never sees.
 *
 *   2. **Readiness is observed, never assumed.** "The process started" is not "the app is
 *      up", and a fixed sleep is either a flake or a waste. Readiness here is a bounded
 *      poll of a TCP connect, short-circuited the moment the child exits.
 *
 *   3. **"Could not connect" is ambiguous, and the ambiguity is dangerous.** A refused
 *      connection looks identical whether the app is broken or the probe is. Every outcome
 *      below is therefore explicitly attributed: a port that was already taken, or a port
 *      that could not be determined at all, is a *harness fault* and is never billed to the
 *      agent. Only "the process ran and never listened" — or exited outright — is a product
 *      failure. Where it is genuinely unclear the harness takes the blame, because a
 *      harness fault miscounted as a product failure is invisible and quietly poisons the
 *      corpus, while the reverse is loud and gets investigated.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import type { RuntimeTarget } from './runtimeTarget.ts';

/** How long to wait for the app to start listening before calling it dead. */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/** Readiness polling cadence — often enough to be quick, rare enough to be cheap. */
const READINESS_POLL_INTERVAL_MS = 250;

/** Grace period between SIGTERM and SIGKILL. */
const GRACEFUL_STOP_TIMEOUT_MS = 5_000;
const FORCED_STOP_TIMEOUT_MS = 2_000;

/** How long to wait for the OS to release the port once the child is reaped. */
const PORT_RELEASE_TIMEOUT_MS = 3_000;

/** Cap on captured child output: enough to diagnose a crash, small enough to print. */
const MAX_CAPTURED_OUTPUT = 64 * 1024;

/** Where the port that answered came from. */
export type PortProvenance =
    | 'remapped'
    | 'declaredDespiteRemap'
    | 'declared'
    | 'announced';

export interface RuntimeFinding {
    code: string;
    message: string;
}

export interface RunningApp {
    /** The port the app was found listening on. */
    readonly port: number;
    readonly baseUrl: string;
    readonly portProvenance: PortProvenance;
    /**
     * Something true and worth saying that is not this gate's verdict — currently only
     * "the app ignored the PORT variable it declared".
     */
    readonly findings: RuntimeFinding[];
    /** Everything the app wrote to stdout and stderr, newest-biased. */
    output(): string;
    stop(): Promise<void>;
}

export type StartOutcome =
    | { kind: 'started'; app: RunningApp }
    | { kind: 'productFailure'; code: string; message: string; output: string }
    | { kind: 'harnessFault'; message: string; output: string };

interface LiveChild {
    child: ChildProcess;
    pid: number;
}

/**
 * Children still running. The `finally` in the session layer is the primary cleanup path;
 * this set backs the cases a `finally` never sees — `process.exit()` from the grader
 * harness, Ctrl-C, a fatal throw.
 */
const liveChildren = new Set<LiveChild>();
let safetyNetInstalled = false;

function installSafetyNet(): void {
    if (safetyNetInstalled) {
        return;
    }
    safetyNetInstalled = true;
    // 'exit' handlers are synchronous, so the only thing available here is an
    // unceremonious SIGKILL — which is right, because by this point nobody is waiting.
    process.on('exit', () => {
        for (const entry of liveChildren) {
            killGroup(entry, 'SIGKILL');
        }
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, () => {
            for (const entry of liveChildren) {
                killGroup(entry, 'SIGKILL');
            }
            process.exit(130);
        });
    }
}

/** Signal the child's whole process group, falling back to the single pid. */
function killGroup(entry: LiveChild, signal: NodeJS.Signals): void {
    try {
        // A negative pid targets the group, so an `npm start` shell and the node process
        // it forked both receive the signal. This is the difference between a clean run
        // and a port held by an orphan nobody can see.
        process.kill(-entry.pid, signal);
    } catch {
        try {
            entry.child.kill(signal);
        } catch {
            // Already reaped.
        }
    }
}

class OutputBuffer {
    private text = '';

    append(chunk: string): void {
        this.text += chunk;
        if (this.text.length > MAX_CAPTURED_OUTPUT) {
            this.text = this.text.slice(this.text.length - MAX_CAPTURED_OUTPUT);
        }
    }

    read(): string {
        return this.text;
    }
}

export interface StartOptions {
    startupTimeoutMs?: number;
}

/**
 * Start `target`, wait for it to listen, and hand back a handle.
 *
 * On every failure path the child is stopped before returning, so a caller that only
 * inspects the outcome cannot leak a process by forgetting to clean up after a failure.
 */
export async function startApp(target: RuntimeTarget, options: StartOptions = {}): Promise<StartOutcome> {
    installSafetyNet();
    const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

    const plan = await planPort(target);
    if (plan.kind === 'harnessFault') {
        return { kind: 'harnessFault', message: plan.message, output: '' };
    }

    const commandLine = describeCommand(target.command, plan.args);
    const output = new OutputBuffer();
    let child: ChildProcess;
    try {
        child = spawn(target.command, plan.args, {
            cwd: target.cwd,
            env: { ...process.env, ...target.env, ...plan.env },
            // Its own process group, so teardown can signal the whole tree.
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
    } catch (error) {
        return { kind: 'harnessFault', message: `could not spawn "${commandLine}": ${describeError(error)}`, output: '' };
    }

    if (typeof child.pid !== 'number') {
        // No pid means no group to signal. Nothing leaks, but nothing was learned either.
        return { kind: 'harnessFault', message: `"${commandLine}" produced no process id, so nothing could be probed.`, output: '' };
    }

    const entry: LiveChild = { child, pid: child.pid };
    liveChildren.add(entry);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => output.append(chunk));
    child.stderr?.on('data', (chunk: string) => output.append(chunk));

    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    child.once('exit', (code, signal) => {
        exit = { code, signal };
    });
    let spawnError: Error | undefined;
    child.once('error', error => {
        spawnError = error;
    });

    const readiness = await waitForReadiness({
        plan,
        output,
        startupTimeoutMs,
        hasExited: () => exit !== undefined,
    });

    if (readiness.kind !== 'listening') {
        await stopChild(entry);
        const captured = output.read();

        if (spawnError) {
            return { kind: 'harnessFault', message: `"${commandLine}" could not be launched: ${spawnError.message}`, output: captured };
        }
        // A port collision says nothing about the product — something else on this machine
        // got there first. Blaming the agent would poison the corpus, so this is the one
        // "died on boot" case that is a harness fault rather than a product failure.
        if (mentionsPortConflict(captured)) {
            return {
                kind: 'harnessFault',
                message: `the app could not bind its port — another process on this machine is holding it (started with "${commandLine}").`,
                output: captured,
            };
        }
        if (readiness.kind === 'portUnknown') {
            return {
                kind: 'harnessFault',
                message: 'the app declared no port, did not use the PORT variable it was given, and never announced one in its output, '
                    + 'so there was nothing to probe. This says nothing about whether the app works — declare a port in '
                    + '.vscode/launch.json (env.PORT) so the runtime gates know where to look.',
                output: captured,
            };
        }
        if (exit) {
            return {
                kind: 'productFailure',
                code: 'appExitedBeforeListening',
                message: `the app exited ${describeExit(exit)} without ever listening (started with "${commandLine}" in ${target.cwd}).`,
                output: captured,
            };
        }
        return {
            kind: 'productFailure',
            code: 'appNeverListened',
            message: `the app was still running after ${Math.round(startupTimeoutMs / 1000)}s but never accepted a connection on `
                + `${describePolledPorts(plan)} (started with "${commandLine}" in ${target.cwd}).`,
            output: captured,
        };
    }

    return {
        kind: 'started',
        app: {
            port: readiness.port,
            baseUrl: `http://127.0.0.1:${readiness.port}`,
            portProvenance: readiness.provenance,
            findings: describeFindings(readiness, target, plan),
            output: () => output.read(),
            stop: () => stopChild(entry),
        },
    };
}

/**
 * An app that answered somewhere other than the port we handed it is an app that ignores
 * `PORT`. That is broken on App Service and Container Apps, which inject it — so the gate
 * does not fail for it (that is a deploy-readiness question, not a "does it run" one) but
 * the signal is recorded rather than thrown away.
 */
function describeFindings(
    readiness: { provenance: PortProvenance; port: number },
    target: RuntimeTarget,
    plan: PortPlanned,
): RuntimeFinding[] {
    if (readiness.provenance !== 'declaredDespiteRemap' && !(readiness.provenance === 'announced' && plan.injectedPort)) {
        return [];
    }
    const key = target.port.remap?.kind === 'arg' ? 'the port argument it declared' : 'the PORT environment variable';
    return [{
        code: 'portEnvironmentVariableIgnored',
        message: `the app ignored ${key} and listened on its hard-coded port ${readiness.port}. `
            + 'Azure App Service and Container Apps inject the port, so this app would not receive traffic there.',
    }];
}

interface PortPlanned {
    kind: 'planned';
    args: string[];
    env: Record<string, string>;
    /** The port we asked the app to use, when we were able to choose one. */
    remappedPort?: number;
    /** The port the project declared for itself. */
    declaredPort?: number;
    /** True when nothing declared a port and PORT was injected speculatively. */
    injectedPort: boolean;
}

type PortPlan = PortPlanned | { kind: 'harnessFault'; message: string };

/**
 * Decide which port the app will be probed on.
 *
 * Where the project lets us choose — because it reads its port from an environment variable
 * or a CLI argument — an unused ephemeral port is substituted. That is not tidiness: it
 * stops concurrent gates fighting over one hard-coded port, and it means a stale process
 * left by an earlier run cannot masquerade as this one. The declared port is still polled
 * as well, so an app that *ignores* the variable it declared is detected rather than
 * falsely failed.
 *
 * When nothing declares a port at all, `PORT` is injected anyway, because reading it is the
 * near-universal Node convention. This replaced an earlier "scan the conventional ports"
 * fallback which was actively dangerous: on a developer machine it connected to macOS
 * Control Center on port 5000 and reported that unrelated service's 403s as the generated
 * app's health responses. A probe that can attribute a stranger's replies to the product is
 * worse than no probe, so the guess is gone — an ephemeral port nobody else could be holding
 * is the honest version of the same idea.
 */
async function planPort(target: RuntimeTarget): Promise<PortPlan> {
    const args = [...target.args];
    const env: Record<string, string> = {};
    const declaredPort = target.port.declared;

    if (target.port.remap && declaredPort !== undefined) {
        const ephemeral = await findFreePort();
        if (ephemeral === undefined) {
            return { kind: 'harnessFault', message: 'no free TCP port could be allocated on this machine.' };
        }
        if (target.port.remap.kind === 'env') {
            env[target.port.remap.key] = String(ephemeral);
        } else {
            const index = target.port.remap.index;
            args[index] = args[index].replace(String(declaredPort), String(ephemeral));
        }
        return { kind: 'planned', args, env, remappedPort: ephemeral, declaredPort, injectedPort: false };
    }

    if (declaredPort !== undefined) {
        if (!await isPortFree(declaredPort)) {
            return {
                kind: 'harnessFault',
                message: `port ${declaredPort} (${target.port.source}) is already in use on this machine, so the app could not be started cleanly.`,
            };
        }
        return { kind: 'planned', args, env, declaredPort, injectedPort: false };
    }

    const ephemeral = await findFreePort();
    if (ephemeral === undefined) {
        return { kind: 'harnessFault', message: 'no free TCP port could be allocated on this machine.' };
    }
    return { kind: 'planned', args, env: { PORT: String(ephemeral) }, remappedPort: ephemeral, injectedPort: true };
}

interface ReadinessArguments {
    plan: PortPlanned;
    output: OutputBuffer;
    startupTimeoutMs: number;
    hasExited: () => boolean;
}

type ReadinessOutcome =
    | { kind: 'listening'; port: number; provenance: PortProvenance }
    | { kind: 'timedOut' }
    | { kind: 'exited' }
    | { kind: 'portUnknown' };

/**
 * Poll until something accepts a connection, the child dies, or the budget runs out.
 *
 * Child liveness is checked every tick, so a crash-on-boot is reported in milliseconds
 * rather than after the full startup budget.
 */
async function waitForReadiness(args: ReadinessArguments): Promise<ReadinessOutcome> {
    const { plan } = args;
    const deadline = Date.now() + args.startupTimeoutMs;

    while (Date.now() < deadline) {
        if (plan.remappedPort !== undefined && await canConnect(plan.remappedPort)) {
            return { kind: 'listening', port: plan.remappedPort, provenance: 'remapped' };
        }
        if (plan.declaredPort !== undefined && await canConnect(plan.declaredPort)) {
            return {
                kind: 'listening',
                port: plan.declaredPort,
                provenance: plan.remappedPort === undefined ? 'declared' : 'declaredDespiteRemap',
            };
        }

        // An app that hard-codes its port usually says so. Reading the number back from the
        // app's own output is the only remaining honest way to find it — and unlike a port
        // scan, a number the app printed cannot belong to somebody else's process.
        const announced = parseAnnouncedPort(args.output.read());
        if (announced !== undefined && announced !== plan.remappedPort && announced !== plan.declaredPort
            && await canConnect(announced)) {
            return { kind: 'listening', port: announced, provenance: 'announced' };
        }

        if (args.hasExited()) {
            return { kind: 'exited' };
        }
        await sleep(READINESS_POLL_INTERVAL_MS);
    }

    if (args.hasExited()) {
        return { kind: 'exited' };
    }
    // Timing out on a port the project *declared* is a product failure: we know exactly
    // where it promised to listen and it did not. Timing out when nothing was declared is
    // a harness fault — the app may well be listening somewhere we could not find, and
    // "the probe could not locate it" must never be billed to the agent as "it never
    // started". This is the 1-versus-3 distinction in one line.
    return plan.injectedPort ? { kind: 'portUnknown' } : { kind: 'timedOut' };
}

function describePolledPorts(plan: PortPlanned): string {
    const ports = [plan.remappedPort, plan.declaredPort].filter(port => port !== undefined);
    return ports.length > 0 ? `port ${[...new Set(ports)].join(' or ')}` : 'any candidate port';
}

/**
 * Stop a child and let the caller know whether the port actually came back.
 *
 * SIGTERM first, so an app with a shutdown handler gets to use it; SIGKILL on the group
 * when it does not. Both are awaited — returning before the process is reaped is exactly
 * how a "cleaned up" run still leaves a port held.
 */
async function stopChild(entry: LiveChild): Promise<void> {
    try {
        if (entry.child.exitCode === null && entry.child.signalCode === null) {
            killGroup(entry, 'SIGTERM');
            if (!await waitForExit(entry.child, GRACEFUL_STOP_TIMEOUT_MS)) {
                killGroup(entry, 'SIGKILL');
                await waitForExit(entry.child, FORCED_STOP_TIMEOUT_MS);
            }
        }
    } finally {
        liveChildren.delete(entry);
    }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(true);
    }
    return new Promise(resolve => {
        const onExit = (): void => {
            clearTimeout(timer);
            resolve(true);
        };
        const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve(false);
        }, timeoutMs);
        child.once('exit', onExit);
    });
}

/**
 * Wait for a port to stop accepting connections.
 *
 * Called after teardown: a port still held once the child is reaped means something
 * escaped the group kill, and the caller says so loudly rather than letting the next run
 * discover it as an unexplained failure.
 */
export async function waitForPortRelease(port: number): Promise<boolean> {
    const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (!await canConnect(port, 200)) {
            return true;
        }
        await sleep(100);
    }
    return false;
}

export function canConnect(port: number, timeoutMs = 500): Promise<boolean> {
    return new Promise(resolve => {
        const socket = createConnection({ port, host: '127.0.0.1' });
        let settled = false;
        const settle = (value: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => settle(true));
        socket.once('timeout', () => settle(false));
        socket.once('error', () => settle(false));
    });
}

export function isPortFree(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '127.0.0.1');
    });
}

function findFreePort(): Promise<number | undefined> {
    return new Promise(resolve => {
        const server = createServer();
        server.once('error', () => resolve(undefined));
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : undefined;
            server.close(() => resolve(port));
        });
    });
}

/** `Server listening on http://localhost:4280`, `listening on :3000`, and friends. */
function parseAnnouncedPort(output: string): number | undefined {
    const patterns = [
        /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i,
        /listening[^\n]*?\b(?:on|at|port)\b[^\n]*?:?\s*(\d{2,5})/i,
        /\bport\s*[:=]\s*(\d{2,5})/i,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(output);
        const port = match ? Number(match[1]) : 0;
        if (port > 0 && port < 65_536) {
            return port;
        }
    }
    return undefined;
}

function mentionsPortConflict(output: string): boolean {
    return /EADDRINUSE|address already in use|port \S+ is already in use/i.test(output);
}

function describeExit(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
    return exit.signal ? `on signal ${exit.signal}` : `with code ${exit.code}`;
}

export function describeCommand(command: string, args: string[]): string {
    return [command, ...args].join(' ');
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
