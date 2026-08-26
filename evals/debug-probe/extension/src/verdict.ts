/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The contract between the probe extension (which writes the verdict) and
 * `evals/graders/validate-debug-breakpoint.ts` (which grades it).
 *
 * Deliberately free of any `vscode` import so the grader can share these types
 * without dragging the extension host API into `evals/tsconfig.json`.
 *
 * The whole reason this file exists is that "the breakpoint was not hit" is
 * several different events with different owners, and collapsing them is the
 * failure mode this gate is built to avoid. See `ProbeOutcome` below.
 */

export const PROBE_SCHEMA_VERSION = 1;

/** Where the verdict is written, relative to the workspace root. */
export const VERDICT_RELATIVE_PATH = '.eval/debug-verdict.json';

/** Where the probe looks for its instructions, relative to the workspace root. */
export const SPEC_RELATIVE_PATH = 'debug-probe.json';

/**
 * Every outcome the probe can render.
 *
 * - `hit`                   the product works: execution reached the breakpoint.
 * - `launchConfigInvalid`   no launch.json, or no configuration by the requested name.
 * - `appFailedToStart`      the launch configuration ran but nothing came up.
 * - `breakpointNotHit`      the app was reachable, but execution never arrived.
 * - `patternMatchedNothing` we could not even place the breakpoint. AMBIGUOUS — see the grader.
 * - `probeError`            the probe itself broke. Never the product's fault.
 */
export type ProbeOutcome =
    | 'hit'
    | 'launchConfigInvalid'
    | 'appFailedToStart'
    | 'breakpointNotHit'
    | 'patternMatchedNothing'
    | 'probeError';

export const PROBE_OUTCOMES: readonly ProbeOutcome[] = [
    'hit',
    'launchConfigInvalid',
    'appFailedToStart',
    'breakpointNotHit',
    'patternMatchedNothing',
    'probeError',
];

export function isProbeOutcome(value: unknown): value is ProbeOutcome {
    return typeof value === 'string' && (PROBE_OUTCOMES as readonly string[]).includes(value);
}

/**
 * What the probe was asked to do. Written into the workspace by the stimulus.
 *
 * `breakpoint` is a *pattern*, never a line number: the agent writes a different
 * project every run, so a hardcoded line grades nothing. js-debug does not support
 * DAP function breakpoints (`supportsFunctionBreakpoints: false`), and VS Code
 * silently discards function breakpoints an adapter does not support rather than
 * reporting an error — so glob + regex resolution is the only option on Node.
 */
export interface ProbeSpec {
    /** Name of a configuration in the workspace's own .vscode/launch.json. */
    launchConfig: string;
    breakpoint: {
        /** Workspace-relative glob. `node_modules` is always excluded. */
        glob: string;
        /** Regex source, matched line by line against each globbed file. */
        pattern: string;
    };
    /** Optional HTTP request used to drive execution to the breakpoint. */
    trigger?: {
        url: string;
    };
    /** Overall budget for the whole probe. Default 120s. */
    timeoutMs?: number;
    /** Quit VS Code once the verdict is written. Used by the certification runner. */
    exitWhenDone?: boolean;
}

/**
 * Why the breakpoint could or could not be placed.
 *
 * These fields exist so a `patternMatchedNothing` can be re-adjudicated from the
 * artifact later without re-running anything. "No file matched the glob" and
 * "found src/server.js but no line matched the regex" are very different claims:
 * the first usually means the product built something other than what we asked
 * for, the second usually means our pattern is too narrow.
 */
export interface BreakpointResolution {
    glob: string;
    pattern: string;
    /** Workspace-relative paths the glob matched. Empty means the glob itself found nothing. */
    filesMatchedByGlob: string[];
    /** Total glob matches, before `filesMatchedByGlob` was capped for readability. */
    globMatchCount: number;
    /** Present only when the regex matched inside one of the globbed files. */
    match?: {
        /** Workspace-relative. */
        file: string;
        /** 1-based, as a human reads it. */
        line: number;
        text: string;
    };
}

/** One breakpoint from a `setBreakpoints` response, straight off the wire. */
export interface AdapterBreakpoint {
    /**
     * DIAGNOSTIC ONLY — never gate on this.
     *
     * js-debug answers `verified: false, message: "Unbound breakpoint"` at set
     * time because the script has not loaded yet, and rebinds later via a
     * `breakpoint` event rather than a fresh `setBreakpoints` response. A
     * breakpoint reported unverified here is routinely hit a moment later, so
     * treating this as a precondition produces a gate that can never pass.
     */
    verified?: boolean;
    /** Adapter-resolved line, which may differ from the one we asked for. */
    line?: number;
    message?: string;
}

export interface AdapterObservation {
    /** What `vscode.debug.startDebugging()` returned. `true` only means "launch initiated". */
    startDebuggingReturned?: boolean;
    /**
     * Whether anything ever accepted a TCP connection on the trigger URL.
     *
     * The trigger request does NOT complete on a healthy run — we break mid-request,
     * so the response never arrives. Connection established is the signal; awaiting
     * the response reports a false `appFailedToStart` against a working app.
     */
    triggerConnected?: boolean;
    setBreakpoints: AdapterBreakpoint[];
    /** Set when the debuggee emitted `terminated` or `exited`. */
    terminated?: string;
}

export interface StoppedObservation {
    /** DAP stop reason. Only `breakpoint` counts as a hit. */
    reason: string;
    /** Function name of the top frame, e.g. `<anonymous>`. */
    frame?: string;
    file?: string;
    line?: number;
    /** Top-frame locals, rendered by the adapter. Evidence the stop was real. */
    locals?: Record<string, string>;
}

export interface DebugProbeVerdict {
    schemaVersion: number;
    outcome: ProbeOutcome;
    /** Human-readable, and the thing that ends up in the MSBench `exec` table's stdErr. */
    detail: string;
    /** Timestamped trace of everything the probe did. Always present, even on probeError. */
    timeline: string[];
    /** Debuggee stdout/stderr as seen via DAP `output` events. Diagnoses appFailedToStart. */
    output: string[];
    spec?: ProbeSpec;
    resolution?: BreakpointResolution;
    adapter?: AdapterObservation;
    stopped?: StoppedObservation;
    durationMs?: number;
}
