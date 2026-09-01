/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Certifies the debug-breakpoint gate.
 *
 * A gate that cannot fail is not a gate, so this proves both directions: the
 * known-good fixture goes green, and every mutation goes red *for the right
 * reason and with the right blame*.
 *
 * Two tiers, because they have very different costs and prerequisites:
 *
 *   offline — synthesises verdict files and checks the grader's exit code for
 *             each. No VS Code, no display, ~1s. This certifies the part that
 *             actually decides blame, so it can run anywhere CI runs.
 *
 *   live    — stages the reference fixture plus four mutations, runs REAL
 *             VS Code with the probe extension against each, and checks that
 *             the probe renders the expected outcome and the grader maps it to
 *             the expected exit code. Needs a VS Code binary and a display.
 *
 * Usage:
 *   node certify.ts                     both tiers
 *   node certify.ts --offline           offline only (CI default)
 *   node certify.ts --live              live only
 *   node certify.ts --vscode=/path/to/code
 *
 * The live tier runs its cases STRICTLY SEQUENTIALLY and must keep doing so —
 * they contend for two ports the fixture hardcodes and the probe cannot remap.
 * See the comment on the loop in `runLiveTier` before trying to speed this up.
 */

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DebugProbeVerdict, ProbeOutcome, ProbeSpec } from './extension/src/verdict.ts';
import { PROBE_SCHEMA_VERSION, VERDICT_RELATIVE_PATH } from './extension/src/verdict.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(HERE, '..');
const GRADER = join(EVALS_ROOT, 'graders', 'validate-debug-breakpoint.ts');
const PROBE_EXTENSION = join(HERE, 'extension');
const FIXTURE = join(EVALS_ROOT, 'grader-certification', 'reference-node-fullstack');

const EXIT_PASS = 0;
const EXIT_PRODUCT_FAILURE = 1;
const EXIT_GRADER_ERROR = 3;

/** The health route the reference fixture serves, and the line the gate breaks on. */
const HEALTH_URL = 'http://127.0.0.1:7071/api/health';
const KNOWN_GOOD_SPEC: ProbeSpec = {
    launchConfig: 'Golden App (debug)',
    breakpoint: { glob: 'src/**/*.js', pattern: "status:\\s*'ok'" },
    trigger: { url: HEALTH_URL },
    timeoutMs: 90_000,
    exitWhenDone: true,
};

interface CaseResult {
    id: string;
    tier: 'offline' | 'live';
    passed: boolean;
    detail: string;
}

// ---------------------------------------------------------------------------------------
// Offline tier: does the grader assign blame correctly?
// ---------------------------------------------------------------------------------------

function verdictFor(outcome: ProbeOutcome, extra: Partial<DebugProbeVerdict> = {}): string {
    const verdict: DebugProbeVerdict = {
        schemaVersion: PROBE_SCHEMA_VERSION,
        outcome,
        detail: `synthesised ${outcome}`,
        timeline: [],
        output: [],
        ...extra,
    };
    return `${JSON.stringify(verdict, null, 2)}\n`;
}

interface OfflineCase {
    id: string;
    description: string;
    /** `undefined` means: do not write a verdict file at all. */
    contents?: string;
    graderArgs?: string[];
    expectedExit: number;
}

const OFFLINE_CASES: OfflineCase[] = [
    {
        id: 'hit-passes',
        description: 'a hit verdict passes',
        contents: verdictFor('hit', {
            stopped: { reason: 'breakpoint', frame: '<anonymous>', file: '/ws/src/server.js', line: 50, locals: { request: 'IncomingMessage' } },
        }),
        expectedExit: EXIT_PASS,
    },
    {
        id: 'launch-config-invalid-is-product-failure',
        description: 'a missing launch configuration is the product\'s fault',
        contents: verdictFor('launchConfigInvalid'),
        expectedExit: EXIT_PRODUCT_FAILURE,
    },
    {
        id: 'app-failed-to-start-is-product-failure',
        description: 'an app that will not boot is the product\'s fault',
        contents: verdictFor('appFailedToStart', { output: ['Error: boom'] }),
        expectedExit: EXIT_PRODUCT_FAILURE,
    },
    {
        id: 'breakpoint-not-hit-is-product-failure',
        description: 'a breakpoint that is never reached is the product\'s fault',
        contents: verdictFor('breakpointNotHit'),
        expectedExit: EXIT_PRODUCT_FAILURE,
    },
    {
        id: 'pattern-miss-defaults-to-harness-fault',
        description: 'an unplaceable breakpoint is ambiguous, so it is OUR fault by default',
        contents: verdictFor('patternMatchedNothing', {
            resolution: { glob: 'src/**/*.js', pattern: 'nope', filesMatchedByGlob: ['src/server.js'], globMatchCount: 1 },
        }),
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'pattern-miss-opt-in-is-product-failure',
        description: 'a stack whose contract guarantees the code can opt in to blaming the product',
        contents: verdictFor('patternMatchedNothing', {
            resolution: { glob: 'src/**/*.js', pattern: 'nope', filesMatchedByGlob: ['src/server.js'], globMatchCount: 1 },
        }),
        graderArgs: ['--pattern-miss-is-product-failure'],
        expectedExit: EXIT_PRODUCT_FAILURE,
    },
    {
        id: 'probe-error-is-harness-fault',
        description: 'a probe that crashed never blames the product',
        contents: verdictFor('probeError'),
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'missing-verdict-is-harness-fault',
        description: 'silence means the probe never ran — Workspace Trust fails exactly this way',
        contents: undefined,
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'malformed-verdict-is-harness-fault',
        description: 'an unparseable verdict is our problem, not the product\'s',
        contents: '{ this is not json',
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'unknown-outcome-is-harness-fault',
        description: 'an outcome the grader does not recognise means the two have drifted',
        contents: `${JSON.stringify({ schemaVersion: PROBE_SCHEMA_VERSION, outcome: 'somethingNew', detail: '', timeline: [], output: [] }, null, 2)}\n`,
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'schema-drift-is-harness-fault',
        description: 'a verdict from a different probe version is not graded on a guess',
        contents: `${JSON.stringify({ schemaVersion: 99, outcome: 'hit', detail: '', timeline: [], output: [] }, null, 2)}\n`,
        expectedExit: EXIT_GRADER_ERROR,
    },
];

/**
 * Best-effort teardown.
 *
 * VS Code keeps writing into its user-data-dir for a moment after the window
 * closes, so a plain recursive delete races it and throws ENOTEMPTY. Failing the
 * certification because cleanup lost a race would be absurd — the verdicts are
 * already collected by this point.
 */
function discard(root: string): void {
    try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch (error) {
        process.stderr.write(`  (could not remove ${root}: ${error instanceof Error ? error.message : String(error)})\n`);
    }
}

function runGraderAgainst(workspace: string, args: string[] = []): { code: number; stderr: string } {
    const result = spawnSync(
        process.execPath,
        ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', GRADER, ...args],
        { cwd: workspace, env: { ...process.env, EVALUATE_WORKSPACE: workspace }, encoding: 'utf8' },
    );
    return { code: result.status ?? -1, stderr: `${result.stderr ?? ''}`.trim() };
}

/**
 * Guard the sun_path limit explicitly rather than rediscovering it as a hang.
 *
 * VS Code opens a Unix domain socket under the --user-data-dir. If the resulting
 * path exceeds the platform cap (~104 bytes on macOS, 108 on Linux) the socket
 * cannot be bound: VS Code starts, never opens a window, writes no logs, and
 * hangs until something kills it. That failure looks exactly like a broken
 * extension, so it is worth an assertion with a name.
 */
function assertSocketPathFits(userDataDir: string): void {
    // Roughly what VS Code appends, e.g. `/1.134.0-main.sock`, with margin.
    const SOCKET_SUFFIX_BUDGET = 30;
    const limit = 104;
    if (userDataDir.length + SOCKET_SUFFIX_BUDGET > limit) {
        throw new Error(
            `--user-data-dir is too long for a Unix domain socket (${userDataDir.length} chars + ~${SOCKET_SUFFIX_BUDGET} for the socket name > ${limit}): ${userDataDir}. ` +
            `VS Code would start, open no window and hang. Use a shorter temp root.`);
    }
}

function runOfflineTier(): CaseResult[] {
    const root = mkdtempSync(join(tmpdir(), 'cor-dbg-off-'));
    try {
        return OFFLINE_CASES.map(testCase => {
            const workspace = join(root, testCase.id);
            mkdirSync(join(workspace, '.eval'), { recursive: true });
            if (testCase.contents !== undefined) {
                writeFileSync(join(workspace, VERDICT_RELATIVE_PATH), testCase.contents, 'utf8');
            }
            const { code, stderr } = runGraderAgainst(workspace, testCase.graderArgs);
            const passed = code === testCase.expectedExit;
            return {
                id: testCase.id,
                tier: 'offline' as const,
                passed,
                detail: passed
                    ? `exit ${code} — ${testCase.description}`
                    : `expected exit ${testCase.expectedExit}, got ${code}. Grader said: ${stderr.split('\n')[0] ?? '(nothing)'}`,
            };
        });
    } finally {
        discard(root);
    }
}

// ---------------------------------------------------------------------------------------
// Live tier: does the probe render the right outcome against real VS Code?
// ---------------------------------------------------------------------------------------

interface LiveCase {
    id: string;
    description: string;
    spec: ProbeSpec;
    expectedOutcome: ProbeOutcome;
    expectedExit: number;
    /** Applied to the staged copy of the fixture before VS Code runs. */
    mutate?: (workspace: string) => void;
    /**
     * Occupy this port from a separate process for the duration of the case.
     * Separate because `spawnSync` blocks this process's event loop, so an
     * in-process listener would never accept a connection.
     */
    squatPort?: number;
}

const LIVE_CASES: LiveCase[] = [
    {
        id: 'known-good',
        description: 'the reference fixture is debuggable and the breakpoint is hit',
        spec: KNOWN_GOOD_SPEC,
        expectedOutcome: 'hit',
        expectedExit: EXIT_PASS,
    },
    {
        id: 'mutation-launch-config-renamed',
        description: 'the named launch configuration does not exist',
        spec: { ...KNOWN_GOOD_SPEC, launchConfig: 'No Such Configuration' },
        expectedOutcome: 'launchConfigInvalid',
        expectedExit: EXIT_PRODUCT_FAILURE,
    },
    {
        id: 'mutation-app-crashes-on-boot',
        description: 'the app throws before it can listen',
        spec: { ...KNOWN_GOOD_SPEC, timeoutMs: 45_000 },
        expectedOutcome: 'appFailedToStart',
        expectedExit: EXIT_PRODUCT_FAILURE,
        mutate: workspace => {
            const server = join(workspace, 'src', 'server.js');
            writeFileSync(server, `throw new Error('certification: simulated boot failure');\n${readFileSync(server, 'utf8')}`, 'utf8');
        },
    },
    {
        id: 'mutation-breakpoint-unreachable',
        description: 'THE gate-can-fail proof: the breakpoint sits on a line the trigger never reaches',
        spec: {
            ...KNOWN_GOOD_SPEC,
            // The POST-400 branch. A GET /api/health can never arrive here.
            breakpoint: { glob: 'src/**/*.js', pattern: 'name is required' },
            timeoutMs: 45_000,
        },
        expectedOutcome: 'breakpointNotHit',
        expectedExit: EXIT_PRODUCT_FAILURE,
    },
    {
        id: 'mutation-pattern-matches-nothing',
        description: 'an unplaceable breakpoint is billed to the harness, not the product',
        spec: {
            ...KNOWN_GOOD_SPEC,
            breakpoint: { glob: 'src/**/*.js', pattern: 'this_pattern_matches_nothing_at_all' },
            timeoutMs: 45_000,
        },
        expectedOutcome: 'patternMatchedNothing',
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'mutation-port-squatted',
        // A stranger holding the app port would otherwise serve the trigger, the
        // breakpoint would never be hit, and a perfectly good project would be
        // failed for it. Binds 0.0.0.0 specifically: a bind-based free-port check
        // against 127.0.0.1 calls that port free on macOS.
        description: 'a stranger on the app port is a harness fault, never a product failure',
        spec: { ...KNOWN_GOOD_SPEC, timeoutMs: 45_000 },
        squatPort: 7071,
        expectedOutcome: 'probeError',
        expectedExit: EXIT_GRADER_ERROR,
    },
    {
        id: 'mutation-attach-config-is-declined',
        // The Azure Functions shape, and the reason this check exists at all.
        //
        // A Functions project's launch configuration is `request: attach` with
        // `preLaunchTask: "func: host start"` — correct, standard, and exactly what the
        // agent's own `.azure/vscode-debug-plan.md` specifies. The probe starts nothing and
        // installs no extensions, so there is no process to attach to, `startDebugging`
        // returns false, and before the preflight the verdict was `appFailedToStart`:
        // exit 1, blaming the product for a project it generated correctly.
        //
        // Measured on grader-certification/stage-local-dev, a faithful Functions workspace:
        // the probe resolved the breakpoint at health.ts:26, confirmed the `node` adapter,
        // confirmed port 7071 free, then sat for 64 seconds and reported a product failure.
        // Removing `preLaunchTask` changed nothing, which is what identifies `request`
        // rather than the task provider as the cause.
        description: 'an attach configuration is one this probe cannot drive, not one the product got wrong',
        spec: { ...KNOWN_GOOD_SPEC, timeoutMs: 45_000 },
        expectedOutcome: 'probeError',
        expectedExit: EXIT_GRADER_ERROR,
        mutate: workspace => {
            const launchPath = join(workspace, '.vscode', 'launch.json');
            const launch = JSON.parse(readFileSync(launchPath, 'utf8')) as {
                configurations: { request?: string; program?: string; port?: number }[];
            };
            // The shape the Azure Functions extension generates: attach to the inspector
            // port that `func host start` opens, rather than launching anything.
            delete launch.configurations[0].program;
            launch.configurations[0].request = 'attach';
            launch.configurations[0].port = 9229;
            writeFileSync(launchPath, `${JSON.stringify(launch, null, 4)}\n`, 'utf8');
        },
    },
    {
        id: 'mutation-debug-adapter-missing',
        // The project-builds shape, in this gate. A launch config naming an
        // adapter this environment does not install is CORRECT — it would work
        // on a developer machine with that extension. Only the harness cannot
        // execute it. Before the preflight, startDebugging simply never resolved
        // and the verdict was appFailedToStart: exit 1, blaming the product for a
        // project it built properly.
        description: 'a debug adapter this environment lacks is an environment gap, not a product failure',
        spec: { ...KNOWN_GOOD_SPEC, timeoutMs: 45_000 },
        expectedOutcome: 'probeError',
        expectedExit: EXIT_GRADER_ERROR,
        mutate: workspace => {
            const launchPath = join(workspace, '.vscode', 'launch.json');
            const launch = JSON.parse(readFileSync(launchPath, 'utf8')) as { configurations: { type?: string }[] };
            launch.configurations[0].type = 'debugpy';
            writeFileSync(launchPath, `${JSON.stringify(launch, null, 4)}\n`, 'utf8');
        },
    },
];

function runLiveTier(vscodeBinary: string, only?: string): CaseResult[] {
    // Short prefix on purpose. VS Code opens a Unix domain socket inside the
    // --user-data-dir, and `sun_path` is capped at ~104 bytes; on macOS
    // os.tmpdir() alone is already ~48 of them. A descriptive directory name
    // here silently pushes the socket path over the limit, and the only symptom
    // is VS Code starting, never opening a window, and hanging until killed —
    // with an empty log directory and no extension activation. Keep it short.
    const root = mkdtempSync(join(tmpdir(), 'cor-dbg-'));
    const results: CaseResult[] = [];
    const cases = only ? LIVE_CASES.filter(testCase => testCase.id === only) : LIVE_CASES;
    try {
        // ─────────────────────────────────────────────────────────────────────────
        // DO NOT PARALLELISE THIS LOOP.
        //
        // Not a style preference and not laziness — the cases contend for two
        // FIXED ports and would corrupt each other's verdicts:
        //
        //   7071  the fixture's app port, pinned by `env.PORT` in its launch.json
        //   9229  the inspector port, pinned by `runtimeArgs: ["--inspect=9229"]`
        //
        // Neither can be remapped from here. VS Code reads `launch.json` directly
        // and is handed only a configuration *name*, so the probe cannot rewrite
        // the ports the way a harness that spawns the process itself could.
        //
        // Run two cases at once and the second one's probe finds a port held by
        // the first one's app. The port guard turns that into `probeError`, so it
        // fails loudly rather than silently — but every case after the first
        // would fail that way, and the suite would look broken instead of
        // parallel. Speeding this up means fixing the hardcoded ports in the
        // fixture first, not removing the sequencing here.
        // ─────────────────────────────────────────────────────────────────────────
        for (const [index, testCase] of cases.entries()) {
            const workspace = join(root, testCase.id);
            cpSync(FIXTURE, workspace, { recursive: true });
            rmSync(join(workspace, '.eval'), { recursive: true, force: true });
            testCase.mutate?.(workspace);
            writeFileSync(join(workspace, 'debug-probe.json'), `${JSON.stringify(testCase.spec, null, 2)}\n`, 'utf8');

            // Squat from a separate process; spawnSync below blocks our event loop,
            // so an in-process server would never accept the probe's connection.
            //
            // `detached: false` keeps it in our process group, but that alone does
            // not save us: if the suite is interrupted (Ctrl-C, a killed shell) the
            // `finally` never runs and the squatter outlives us, holding 7071. Every
            // later run then fails its port preflight — the suite poisons itself,
            // and the symptom looks like a broken gate rather than a stale process.
            // So it is also killed on the way out under any signal.
            let squatter: ReturnType<typeof spawn> | undefined;
            let killSquatter = (): void => { /* no-op */ };
            if (testCase.squatPort !== undefined) {
                squatter = spawn(process.execPath, [
                    '-e',
                    `require('node:net').createServer(s => s.end()).listen(${testCase.squatPort}, '0.0.0.0', () => setTimeout(() => {}, 1e9))`,
                ], { stdio: 'ignore', detached: false });
                killSquatter = () => { try { squatter?.kill('SIGKILL'); } catch { /* already gone */ } };
                for (const signal of ['exit', 'SIGINT', 'SIGTERM'] as const) {
                    process.once(signal, killSquatter);
                }
                spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)']);
            }

            try {
            process.stderr.write(`  running ${testCase.id} in real VS Code…\n`);
            // Hard wall clock per case. A hung VS Code must fail its own case, not
            // stall the whole certification the way it would stall an MSBench run.
            const launchBudgetMs = (testCase.spec.timeoutMs ?? 120_000) + 180_000;
            // `u<n>` rather than the case id, for the sun_path reason above.
            const userDataDir = join(root, `u${index}`);
            assertSocketPathFits(userDataDir);
            const launchArgs = [
                `--extensionDevelopmentPath=${PROBE_EXTENSION}`,
                `--user-data-dir=${userDataDir}`,
                // Untrusted workspaces block extension activation entirely, and the
                // only symptom is an absent verdict file.
                '--disable-workspace-trust',
                '--disable-extensions',
                '--new-window',
                '--wait',
                workspace,
            ];
            if (verbose) {
                process.stderr.write(`    ${vscodeBinary} ${launchArgs.join(' ')}\n`);
            }
            const launch = spawnSync(vscodeBinary, launchArgs, { encoding: 'utf8', timeout: launchBudgetMs, killSignal: 'SIGKILL' });
            if (verbose) {
                process.stderr.write(`    status=${launch.status} signal=${launch.signal} stderr=${JSON.stringify((launch.stderr ?? '').slice(0, 400))}\n`);
            }

            if (launch.error) {
                const activated = existsSync(join(workspace, '.eval', 'probe.log'));
                results.push({
                    id: testCase.id,
                    tier: 'live',
                    passed: false,
                    detail: `VS Code did not finish: ${launch.error.message} (probe ${activated ? 'DID' : 'did NOT'} activate)`
                        + `${launch.stderr ? `\n        vscode stderr: ${`${launch.stderr}`.trim().split('\n').slice(-3).join(' | ')}` : ''}`,
                });
                continue;
            }

            let outcome: string;
            try {
                outcome = (JSON.parse(readFileSync(join(workspace, VERDICT_RELATIVE_PATH), 'utf8')) as DebugProbeVerdict).outcome;
            } catch {
                const activated = existsSync(join(workspace, '.eval', 'probe.log'));
                results.push({
                    id: testCase.id,
                    tier: 'live',
                    passed: false,
                    detail: activated
                        ? 'the probe activated but never wrote a verdict'
                        : 'the probe never activated — check Workspace Trust and the extension development path',
                });
                continue;
            }

            const { code, stderr } = runGraderAgainst(workspace);
            const passed = outcome === testCase.expectedOutcome && code === testCase.expectedExit;
            results.push({
                id: testCase.id,
                tier: 'live',
                passed,
                detail: passed
                    ? `outcome=${outcome}, exit ${code} — ${testCase.description}`
                    : `expected outcome=${testCase.expectedOutcome} exit=${testCase.expectedExit}, got outcome=${outcome} exit=${code}. Grader said: ${stderr.split('\n')[0] ?? '(nothing)'}`,
            });
            } finally {
                killSquatter();
                for (const signal of ['exit', 'SIGINT', 'SIGTERM'] as const) {
                    process.removeListener(signal, killSquatter);
                }
            }
        }
        return results;
    } finally {
        discard(root);
    }
}

// ---------------------------------------------------------------------------------------

let verbose = false;

/**
 * A VS Code binary this process can actually `spawnSync`.
 *
 * `'code'` works on macOS and Linux, where it is a shell script on PATH. On Windows it is
 * `code.cmd`, which `spawnSync` cannot execute without a shell — so the live tier died with
 * `spawnSync code ENOENT` before a single case ran, and reported that as seven identical
 * "VS Code did not finish … (probe did NOT activate)" failures.
 *
 * That wording is why it survived: it reads as a broken probe rather than a runner that
 * never started one. The live tier had never been run on Windows at all, and the only way
 * through was already knowing to pass `--vscode=`. A gate whose negative controls cannot be
 * executed is a gate nobody can confirm still discriminates — which is the whole point of
 * this file.
 *
 * `Code.exe` is resolved rather than `code.cmd` because it is directly executable. Shelling
 * out instead would push a path containing `Microsoft VS Code` through cmd quoting for no
 * benefit. The bin script lives at `<root>/bin/code.cmd` and the executable at
 * `<root>/Code.exe`, so PATH still does the discovery and this only walks up from it.
 */
function resolveVsCode(explicit: string | undefined): string {
    if (explicit) {
        return explicit;
    }
    if (process.platform !== 'win32') {
        return 'code';
    }
    const onPath = (process.env.PATH ?? '')
        .split(delimiter)
        .map(entry => join(entry, 'code.cmd'))
        .find(candidate => existsSync(candidate));
    const candidates = [
        ...(onPath ? [resolve(dirname(onPath), '..', 'Code.exe')] : []),
        join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe'),
        join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft VS Code', 'Code.exe'),
    ];
    const found = candidates.find(candidate => existsSync(candidate));
    if (found) {
        return found;
    }
    // Falling back to 'code' would reproduce the ENOENT this exists to prevent, and the
    // failure would again be reported per-case as a probe that did not activate.
    throw new Error(
        'could not find Code.exe. The live tier spawns VS Code directly, and on Windows `code` is a\n'
        + `.cmd that spawnSync cannot execute. Looked in:\n  ${candidates.join('\n  ')}\n`
        + 'Pass --vscode=<path to Code.exe> to override.',
    );
}

function main(): void {
    const args = process.argv.slice(2);
    const offlineOnly = args.includes('--offline');
    const liveOnly = args.includes('--live');
    verbose = args.includes('--verbose');
    const only = args.find(arg => arg.startsWith('--only='))?.split('=')[1];
    const explicitVsCode = args.find(arg => arg.startsWith('--vscode='))?.split('=')[1];

    const results: CaseResult[] = [];
    if (!liveOnly) {
        process.stderr.write('Offline tier — grader blame mapping\n');
        results.push(...runOfflineTier());
    }
    if (!offlineOnly) {
        process.stderr.write('Live tier — real VS Code, real js-debug\n');
        // Resolved here rather than with the other arguments: `resolveVsCode` throws when it
        // cannot find one, and the offline tier is the CI tier and needs no VS Code at all.
        // Resolving eagerly would make `--offline` fail on exactly the machines it is for.
        results.push(...runLiveTier(resolveVsCode(explicitVsCode), only));
    }

    process.stderr.write('\n');
    for (const result of results) {
        process.stderr.write(`  ${result.passed ? 'PASS' : 'FAIL'}  [${result.tier}] ${result.id}: ${result.detail}\n`);
    }

    const failed = results.filter(result => !result.passed);
    process.stderr.write(`\n${results.length - failed.length}/${results.length} certification cases passed\n`);
    if (failed.length > 0) {
        process.stderr.write(`FAILED: ${failed.map(result => result.id).join(', ')}\n`);
        process.exit(1);
    }
    process.stderr.write('The gate passes on the known-good fixture and goes red on every mutation.\n');
}

main();
