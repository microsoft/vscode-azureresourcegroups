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
 * Matches a call line, verbatim from run 2026082583236973:
 *
 *   [2026-08-25T23:11:14.772Z] [CAPI PROXY] [9] POST /v1/messages -> 429
 *
 * That bracketed-ISO form is the only shape the proxy emits — checked against
 * all seven stored runs, in which the abbreviated `23:11:14.772 [9] POST ...`
 * style used in some hand-written notes appears zero times. Deliberately not
 * accepting that second form: it would be a branch no artifact can exercise, so
 * it could not be tested and would rot silently. If the proxy's format ever
 * does change, the census printing nothing is the loud signal to update this.
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
 * A dated release suffix, e.g. the `-2024-07-18` in `gpt-4o-mini-2024-07-18`.
 *
 * This is the *only* difference tolerated between the requested and the active
 * id. An earlier version of this accepted any suffix (`a.startsWith(b + '-')`),
 * which is badly wrong: it makes `gpt-5` match `gpt-5-mini`, a cheaper and less
 * capable model. That is precisely the mismatch this check exists to catch, and
 * exactly what a model sweep would hit.
 *
 * A bare numeric revision (`claude-opus-4` vs `claude-opus-4-1`) is deliberately
 * NOT tolerated either. Opus 4.1 is a different model from Opus 4, with
 * different behaviour and cost, so treating them as equal would silently
 * mislabel a sweep datapoint. If the harness ever starts reporting a revision we
 * did not request, that should be a loud failure and a conscious decision, not
 * something absorbed by a lenient matcher.
 */
const DATED_RELEASE_SUFFIX = /^-\d{4}-\d{2}-\d{2}$/;

/**
 * The pairs that define the boundary, asserted by `--self-test`.
 *
 * Kept as data rather than prose so the next person can see — and re-run — the
 * exact cases the matcher must accept and must reject.
 */
const MODEL_MATCH_CASES: readonly (readonly [string, string, boolean])[] = [
    // Same model, written two ways: the log may carry the dated release id.
    ['gpt-4o-mini', 'gpt-4o-mini-2024-07-18', true],
    ['gpt-4o-mini-2024-07-18', 'gpt-4o-mini', true],
    ['gpt-4.1', 'gpt-4.1-2025-04-14', true],
    ['claude-sonnet-4.5', 'claude-sonnet-4.5', true],
    ['Claude-Sonnet-4.5', 'claude-sonnet-4.5 ', true],

    // Different models. Every one of these was accepted by the old prefix
    // matcher, and each would have mislabelled a model sweep datapoint.
    ['gpt-5', 'gpt-5-mini', false],
    ['gpt-4o', 'gpt-4o-mini', false],
    ['claude-opus-4', 'claude-opus-4-1', false],
    ['gpt-5.6', 'gpt-5.6-sol', false],
    ['claude-sonnet-4.5', 'claude-haiku-4.5', false],
    ['gpt-5-mini', 'gpt-5', false],

    // A dated suffix on a *different* family is still a different model: the
    // date pattern must never be checked without confirming the prefix first.
    ['gpt-4o', 'claude-2024-07-18', false],
];

/**
 * True when `requested` and `observed` name the same model.
 *
 * Equality, or one being the other plus a dated release suffix. Nothing else —
 * see DATED_RELEASE_SUFFIX and MODEL_MATCH_CASES for the boundary.
 */
function modelMatches(requested: string, observed: string): boolean {
    const a = requested.trim().toLowerCase();
    const b = observed.trim().toLowerCase();
    if (a === b) {
        return true;
    }
    const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
    // The prefix test must come first: without it, `gpt-4o` vs
    // `claude-2024-07-18` would slice to `-2024-07-18` and match.
    if (!longer.startsWith(shorter)) {
        return false;
    }
    return DATED_RELEASE_SUFFIX.test(longer.slice(shorter.length));
}

/** Assert the matcher's boundary. Run with `node verify-run.ts --self-test`. */
function selfTest(): void {
    const failures = MODEL_MATCH_CASES.filter(([a, b, expected]) => modelMatches(a, b) !== expected);
    for (const [a, b, expected] of MODEL_MATCH_CASES) {
        const actual = modelMatches(a, b);
        const status = actual === expected ? 'ok  ' : 'FAIL';
        console.log(`  ${status} ${expected ? 'match   ' : 'reject  '} ${a}  vs  ${b}`);
    }
    if (failures.length) {
        console.error(`\n${failures.length} model-matcher case(s) failed.`);
        process.exit(1);
    }
    console.log(`\n${MODEL_MATCH_CASES.length} model-matcher cases passed.`);
}

interface ModelVerdict {
    readonly requested?: string;
    readonly active?: string;
    readonly mismatch: boolean;
    /** True when the check could not run at all — distinct from "verified OK". */
    readonly unverified?: boolean;
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
        return { requested, active, mismatch: false, unverified: true, note: 'no modelSelector.id to compare against' };
    }
    if (!active) {
        // Fail open, loudly.
        //
        // A run that died before model selection legitimately has no such line,
        // and absent evidence is not evidence of the wrong model. Failing closed
        // would turn every missing artifact into a fake "model mismatch" and, if
        // a future harness version stopped emitting the line, would block every
        // run on a false accusation — the same disease as a detector that hides
        // true reds, just pointed the other way.
        //
        // The cost of that choice is that the check could silently disappear, so
        // it is reported as its own prominent state rather than folded into a
        // pass. `unverified` is not `verified OK`.
        return { requested, active, mismatch: false, unverified: true, note: 'no "Set active model to:" line in agent-output.log or entry.log' };
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
    if (args.includes('--self-test')) {
        selfTest();
        return;
    }
    if (!runDir) {
        console.error('usage: verify-run.ts --run-dir <extracted results dir> [--run-id <id>] [--expected-model <id>]');
        console.error('       verify-run.ts --self-test');
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
    if (model.unverified) {
        // Deliberately not a quiet aside. This is a third state next to
        // "matches" and "mismatch", and the one that would otherwise let the
        // check rot away unnoticed.
        console.log('      !! IDENTITY NOT VERIFIED — this is NOT a pass.');
        console.log(`      !! ${model.note}`);
        console.log('      !! The run stands, but nothing confirmed which model answered.');
    } else if (model.note) {
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
                        'limit had already cleared by the next request.',
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
            'Retry; do not wait for a quota window. Measured on run',
            '2026082811285762: the 429 arrived after only 2 requests in the',
            'preceding 10s, and the same surface returned 200 again 335ms',
            'later — shared backend congestion, not a budget this account',
            'spent. Waiting 15-45min did not improve the next attempt, and',
            'successful calls before the throttle varied 3/11/15/44 with no',
            'relation to idle time. Attempts are independent draws, so retry',
            'promptly and expect several before one lands.',
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

    console.log(model.unverified
        ? '    this run is a result (model identity unverified — see above).'
        : '    verified: this run is a result.');
}

main();
