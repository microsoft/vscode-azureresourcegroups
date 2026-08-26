#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decide whether a finished MSBench run is a *result* before anyone reads its
 * results table.
 *
 * Two failure modes look exactly like ordinary output but mean something else
 * entirely, and both are invisible in the table itself:
 *
 *   1. The Copilot API throttled the agent mid-run. The agent then produced
 *      nothing, so artifact assertions fail while negative assertions pass
 *      trivially — pixel-identical to a product regression.
 *   2. The model that answered was not the model we asked for. The harness
 *      already refuses an *unknown* id outright, so this is a light identity
 *      check rather than fallback protection — see verifyModel below.
 *
 * Exit codes are the contract with run.sh:
 *
 *   0   the run is a result — go ahead and read the table
 *   75  EX_TEMPFAIL: throttled. Not a result at all; retry later
 *   65  EX_DATAERR: the run measured something other than what was requested
 *
 * 75 and 65 are deliberately distinct from 1. A genuinely red run — a real
 * product failure — must keep reporting as a red run, because a detector for
 * false reds is worthless if it also hides true ones.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `<sysexits.h>`: a transient condition, retry later. Not a failed assertion. */
const EX_TEMPFAIL = 75;
/** `<sysexits.h>`: the run's own data is wrong, so its numbers mean nothing. */
const EX_DATAERR = 65;

/** One upstream model call, as recorded by the CAPI proxy. */
interface ProxyCall {
    readonly at: number;
    readonly index: number;
    readonly method: string;
    readonly path: string;
    readonly status: number;
}

/**
 * `[2026-08-25T23:11:14.772Z] [CAPI PROXY] [9] POST /v1/messages -> 429`
 *
 * The proxy also logs response headers and bodies on their own lines under the
 * same request index; only the request/status line is of interest here.
 */
const CALL_LINE = /^\[([^\]]+)\]\s+\[CAPI PROXY\]\s+\[(\d+)\]\s+([A-Z]+)\s+(\S+)\s+->\s+(\d+)\s*$/;

function parseProxyLog(text: string): ProxyCall[] {
    const calls: ProxyCall[] = [];
    for (const line of text.split('\n')) {
        const match = CALL_LINE.exec(line.trimEnd());
        if (!match) {
            continue;
        }
        const at = Date.parse(match[1]);
        calls.push({
            at: Number.isNaN(at) ? 0 : at,
            index: Number(match[2]),
            method: match[3],
            path: match[4],
            status: Number(match[5]),
        });
    }
    return calls;
}

/**
 * Every distinct surface the run touched, with a status breakdown.
 *
 * Paths are whatever the log says — nothing here matches a known list. At
 * least four are in play (`/v1/messages`, `/chat/completions`, `/responses`,
 * `/embeddings`, plus `GET /models`), the set moves as new models ship, and a
 * hardcoded list would silently miss a 429 on a surface added later. Missing a
 * 429 is the exact failure this check exists to prevent.
 *
 * Worth printing on *every* run, not just throttled ones: it turns each run
 * into a free datapoint about which surfaces we lean on and how hard, which is
 * what a per-surface token budget has to be built from. The mix is
 * model-dependent — Claude runs use both `/v1/messages` and `/chat/completions`,
 * while GPT runs touch `/v1/messages` zero times — so a census of all paths
 * says considerably more than a single throttled path would.
 */
function census(calls: ProxyCall[]): string[] {
    const byPath = new Map<string, Map<number, number>>();
    for (const call of calls) {
        const key = `${call.method} ${call.path}`;
        const statuses = byPath.get(key) ?? new Map<number, number>();
        statuses.set(call.status, (statuses.get(call.status) ?? 0) + 1);
        byPath.set(key, statuses);
    }
    return [...byPath.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, statuses]) => {
            const breakdown = [...statuses.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([status, count]) => `${count}x ${status}`)
                .join(', ');
            return `${key.padEnd(28)} ${breakdown}`;
        });
}

interface ThrottleEvidence {
    readonly surface: string;
    /** Successful upstream calls anywhere before the throttle landed. */
    readonly successesBefore: number;
    /** Successful calls on the throttled surface specifically. */
    readonly successesOnSurface: number;
    /** A call on a *different* surface that succeeded after the 429, if any. */
    readonly recoveredOn?: string;
    readonly recoveredAfterMs?: number;
}

/**
 * The finding this whole check exists for: a 429 is scoped to one API surface,
 * not to the account.
 *
 * `/v1/messages` is the Anthropic surface (Claude models); `/chat/completions`
 * and `/responses` are OpenAI ones. They throttle independently, which is why a
 * run can be refused on one and, in the observed case 666 ms later, served on
 * another. Recording *which* surface ran out, and after how many calls,
 * upgrades the signal from "this run was throttled" to something a token budget
 * can act on. The surface is read from the log, never assumed.
 */
function findThrottle(calls: ProxyCall[]): ThrottleEvidence | undefined {
    const firstThrottled = calls.findIndex(call => call.status === 429);
    if (firstThrottled === -1) {
        return undefined;
    }
    const throttled = calls[firstThrottled];
    const surface = `${throttled.method} ${throttled.path}`;
    const before = calls.slice(0, firstThrottled);
    const ok = (call: ProxyCall) => call.status >= 200 && call.status < 400;

    const recovery = calls
        .slice(firstThrottled + 1)
        .find(call => ok(call) && `${call.method} ${call.path}` !== surface);

    return {
        surface,
        successesBefore: before.filter(ok).length,
        successesOnSurface: before.filter(call => ok(call) && `${call.method} ${call.path}` === surface).length,
        recoveredOn: recovery && `${recovery.method} ${recovery.path}`,
        recoveredAfterMs: recovery && recovery.at && throttled.at ? recovery.at - throttled.at : undefined,
    };
}

/**
 * Read `modelSelector.id` out of a user-overrides.yaml.
 *
 * Deliberately a regex rather than a YAML parse: this runs from run.sh on a
 * machine that may not have `evals/node_modules` installed, and the shape being
 * read is two fixed lines. msbench's own CLI reads the same key the same way.
 */
function readModelSelectorId(yamlPath: string): string | undefined {
    if (!existsSync(yamlPath)) {
        return undefined;
    }
    const match = /^modelSelector:\s*$[\s\S]*?^\s+id:\s*["']?([^"'\s#]+)/m.exec(readFileSync(yamlPath, 'utf8'));
    return match?.[1];
}

function firstExisting(...paths: string[]): string | undefined {
    return paths.find(path => existsSync(path));
}

/**
 * Tolerate a dated or otherwise more specific id on either side —
 * `gpt-4o-mini` vs `gpt-4o-mini-2024-07-18` is the same model, and the log may
 * carry the long form. A changed family (`claude-sonnet-4.5` for `gpt-5.6-sol`)
 * is still rejected.
 */
function modelMatches(requested: string, observed: string): boolean {
    const a = requested.trim().toLowerCase();
    const b = observed.trim().toLowerCase();
    return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

interface ModelVerdict {
    readonly requested?: string;
    readonly active?: string;
    readonly mismatch: boolean;
    readonly note?: string;
}

/**
 * Assert that the model which answered is the model we asked for.
 *
 * This is deliberately *small*, because the harness already covers the scary
 * case. `selectActiveModel` in vscode-copilot-evaluation's capiProxyServer.ts
 * looks the requested id up in the live `GET /models` catalogue and throws
 * `X_MODEL_NOT_FOUND_ERROR` when it is absent, then pins `is_chat_fallback` and
 * `model_picker_enabled` on the matched entry so VS Code cannot substitute
 * anything else. An unknown id therefore hard-fails at launch, before any agent
 * turn — verified empirically with `gpt-5` and `gpt-5.6`, which cost ~0 tokens.
 * So there is no silent fallback to detect and no machinery worth building
 * for one.
 *
 * Existence is not identity, though. This checks the one line that states which
 * model actually became active, so that a future regression in model selection
 * shows up as a failed run rather than as a quietly mislabelled datapoint —
 * which matters most during model sweeps, where every run is supposed to be a
 * different model.
 *
 * `Set active model to: <id>` is emitted into `vsc-output/agent-output.log`
 * (mirrored in `entry.log`); present in all seven stored runs checked.
 * Note it is *not* in capi-proxy.log, despite being the proxy's decision.
 */
function verifyModel(outputDir: string, expectedOverride?: string): ModelVerdict {
    const requested = expectedOverride ?? readModelSelectorId(join(HERE, 'assets', 'user-overrides.yaml'));

    const logPath = firstExisting(
        join(outputDir, 'vsc-output', 'agent-output.log'),
        join(outputDir, 'entry.log'),
    );
    const active = logPath
        ? /Set active model to:\s*(\S+)/.exec(readFileSync(logPath, 'utf8'))?.[1]
        : undefined;

    if (!requested) {
        return { requested, active, mismatch: false, note: 'no modelSelector.id to compare against' };
    }
    if (!active) {
        // A run that died before model selection legitimately has no such line,
        // and absent evidence is not evidence of the wrong model. Say so.
        return { requested, active, mismatch: false, note: 'no "Set active model to:" line — identity not verified' };
    }
    return { requested, active, mismatch: !modelMatches(requested, active) };
}

function banner(lines: string[]): void {
    const rule = '  ============================================================';
    console.log('');
    console.log(rule);
    for (const line of lines) {
        console.log(`  ${line}`);
    }
    console.log(rule);
    console.log('');
}

function main(): void {
    const args = process.argv.slice(2);
    const valueOf = (flag: string): string | undefined => {
        const index = args.indexOf(flag);
        return index !== -1 ? args[index + 1] : undefined;
    };

    const runDir = valueOf('--run-dir');
    if (!runDir) {
        console.error('usage: verify-run.ts --run-dir <extracted results dir> [--run-id <id>] [--expected-model <id>]');
        process.exit(2);
    }
    const runId = valueOf('--run-id') ?? 'unknown';
    const outputDir = firstExisting(join(runDir, 'output'), runDir) ?? runDir;

    console.log(`==> Verifying run ${runId} before reading its results`);

    // --- what the agent actually asked the models --------------------------
    const proxyLog = join(outputDir, 'vsc-output', 'capi-proxy.log');
    let throttle: ThrottleEvidence | undefined;
    if (existsSync(proxyLog)) {
        const calls = parseProxyLog(readFileSync(proxyLog, 'utf8'));
        console.log('    upstream model calls (capi-proxy.log):');
        for (const line of census(calls)) {
            console.log(`      ${line}`);
        }
        throttle = findThrottle(calls);
    } else {
        console.log('    upstream model calls: capi-proxy.log absent — skipped');
    }

    // --- did we measure the model we asked for? ----------------------------
    const model = verifyModel(outputDir, valueOf('--expected-model'));
    console.log('    model:');
    console.log(`      requested (user-overrides.yaml)  ${model.requested ?? '-'}`);
    console.log(`      active    (agent-output.log)     ${model.active ?? '-'}`);
    if (model.note) {
        console.log(`      note: ${model.note}`);
    }

    // --- verdict -----------------------------------------------------------
    //
    // `error.json` -> RATE_LIMIT stays the sole authority on whether the run is
    // void. A 429 in the proxy log means a request was refused, not that the
    // run failed: the agent frequently retries and finishes normally, and
    // voiding those would start hiding real red runs. So the proxy log enriches
    // the verdict, it does not cast it.
    const errorJson = join(outputDir, 'error.json');
    const rateLimited = existsSync(errorJson) && /"type":\s*"RATE_LIMIT"/.test(readFileSync(errorJson, 'utf8'));

    if (rateLimited) {
        const detail = throttle
            ? [
                `Throttled on ${throttle.surface} after ${throttle.successesBefore} successful`,
                `upstream calls (${throttle.successesOnSurface} of them on that surface).`,
                ...(throttle.recoveredOn
                    ? [
                        `${throttle.recoveredOn} then succeeded${throttle.recoveredAfterMs !== undefined ? ` ${throttle.recoveredAfterMs}ms later` : ''}, so the`,
                        'limit is scoped to that one API surface, not to the account.',
                    ]
                    : []),
                '',
            ]
            : [];
        banner([
            'RATE_LIMIT — this run is NOT a result. Do not read the table.',
            '',
            'The Copilot API throttled the agent mid-run, so it produced',
            'nothing. Positive assertions fail and negative ones pass',
            'trivially, which looks exactly like an agent regression.',
            '',
            ...detail,
            'Runs cost ~250k tokens each; roughly 3 in 15 minutes is the',
            'observed ceiling. Wait ~15 minutes and re-run.',
            '',
            `Run id: ${runId}`,
        ]);
        process.exit(EX_TEMPFAIL);
    }

    if (throttle) {
        // Refused but recovered. Say so — it is the early warning that the
        // budget for this surface is nearly spent — then let the run stand.
        console.log('');
        console.log(`    NOTE: ${throttle.surface} returned 429 after ${throttle.successesBefore} successful calls,`);
        console.log('          but the run completed. Results stand; budget is running low.');
    }

    if (model.mismatch) {
        banner([
            'MODEL MISMATCH — this run did not measure what you asked for.',
            '',
            `Requested: ${model.requested ?? '-'}`,
            `Active:    ${model.active ?? '-'}`,
            '',
            'An unknown model id hard-fails at launch, so this means model',
            'selection resolved a known id to a different model than the one',
            'asked for. Treat these numbers as belonging to the active model.',
            '',
            `Run id: ${runId}`,
        ]);
        process.exit(EX_DATAERR);
    }

    console.log('    verified: this run is a result.');
}

main();
