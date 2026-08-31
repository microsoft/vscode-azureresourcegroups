/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Downloading a finished MSBench run's stored results, and finding the per-instance
 * output trees inside it.
 *
 * Extraction is **free** — it reads a stored blob and never touches a model — and that
 * single property is what both consumers are built on:
 *
 *   - `regrade.ts`      re-judges a past run against today's graders for zero tokens.
 *   - `harvest-seed.ts` promotes a past run's `.azure/project-plan.md` into the scaffold
 *                       seed, so the scaffold phase starts from real planner output
 *                       rather than a hand-maintained fixture.
 *
 * This lives in its own module because those two want the *same* download and the *same*
 * notion of "which instances does this extraction contain", and the second arrived long
 * after the first. Copying it would put the `msbench-cli`-not-on-PATH message, the
 * auth-failure hint, and — the one that actually matters — the rule that an instance
 * with no `session.sqlite` is *reported* rather than skipped, in two places that drift.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * A tool fault rather than a product verdict.
 *
 * Both consumers print `.message` alone rather than a stack, so every throw site has to
 * carry a complete explanation including what to do about it.
 */
export class MsBenchToolError extends Error { }

/** Where extractions are cached when no explicit directory is given. Gitignored. */
export const CACHE_ROOT = join(import.meta.dirname, '.regrade');

/**
 * The virtualenv script directory for this platform: `Scripts` on Windows, `bin` elsewhere.
 *
 * Only ever used to build the "put msbench-cli on PATH" hint, but a hint naming a directory
 * that does not exist is worse than no hint — it reads as authoritative and sends the reader
 * looking for a bug in their own setup. `run.sh` has always branched on this; the tools that
 * print the same advice did not, and told every Windows developer to add a `bin` directory
 * their venv has never had.
 */
export function venvBinDir(): string {
    return process.platform === 'win32' ? 'Scripts' : 'bin';
}

export interface Instance {
    /** Directory name minus the `-output` suffix, e.g. `vscbench.eval.x86_64.say_hello`. */
    name: string;
    vscOutput: string;
    sqlitePath: string;
    configPath: string;
    evalJsonPath: string;
}

export interface ExtractRequest {
    runId?: string;
    /** Re-use an existing extraction and skip the download entirely. */
    extractedDir?: string;
    /** Where to extract. Defaults to `<CACHE_ROOT>/<run-id>`. */
    extractDir?: string;
    /** Narrow the download to a single instance. */
    instance?: string;
    /** Download again even when the target directory already holds a usable extraction. */
    refresh?: boolean;
}

/**
 * Callers route diagnostics differently — `regrade.ts` sends them to stderr under
 * `--json` so stdout stays one parseable document — so the sink is theirs to choose.
 */
type Logger = (message: string) => void;

/**
 * `extract` is free — it only downloads a stored results blob and never touches a
 * model — but it is not instant, so an existing extraction is reused by default.
 */
export function resolveExtraction(request: ExtractRequest, log: Logger = console.log): string {
    if (request.extractedDir) {
        const dir = resolve(request.extractedDir);
        if (!existsSync(dir)) {
            throw new MsBenchToolError(`--extracted ${dir} does not exist`);
        }
        return dir;
    }

    const { runId, instance: wanted } = request;
    if (!runId) {
        throw new MsBenchToolError('No run id to extract');
    }

    const dir = resolve(request.extractDir ?? join(CACHE_ROOT, runId));
    // Only reuse a cache that actually holds what was asked for: a cache built by
    // an earlier `--instance A` must not silently satisfy a later `--instance B`.
    const cached = findInstances(dir).instances;
    const satisfiesRequest = cached.length > 0 &&
        (!wanted || cached.some(candidate => matchesInstance(candidate.name, wanted)));

    if (!request.refresh && satisfiesRequest) {
        log(`Reusing extraction at ${dir} (--refresh to re-download)`);
        return dir;
    }

    mkdirSync(dirname(dir), { recursive: true });
    const args = ['extract', '--run_id', runId, '--output', dir];
    if (wanted) {
        args.push('--instance', wanted);
    }

    log(`$ msbench-cli ${args.join(' ')}`);
    const result = spawnSync('msbench-cli', args, { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new MsBenchToolError(
            'msbench-cli is not on PATH. Run:\n' +
            `  export PATH="$HOME/.msbench-venv/${venvBinDir()}:$PATH"\n` +
            'Invoking it by absolute path breaks its plugin discovery, so it has to be on PATH.'
        );
    }
    if (result.status !== 0) {
        throw new MsBenchToolError(
            `msbench-cli extract exited ${result.status}. If this is an auth failure, run \`az login\` — ` +
            'extraction reads a stored blob and needs an Azure identity.'
        );
    }
    return dir;
}

/** `say_hello` should select `vscbench.eval.x86_64.say_hello`, but not by accident. */
export function matchesInstance(name: string, requested: string): boolean {
    return name === requested || name.endsWith(`.${requested}`) || name.includes(requested);
}

/**
 * An MSBench extraction holds one `<instance>-output/output/vsc-output` tree per
 * instance. A directory with no `session.sqlite` is *reported* rather than
 * quietly skipped: that is an instance whose output blob never arrived —
 * infrastructure failing rather than a verdict — and dropping it silently would
 * let a partial extraction report a clean bill of health.
 */
export function findInstances(root: string): { instances: Instance[]; incomplete: string[] } {
    if (!existsSync(root)) {
        return { instances: [], incomplete: [] };
    }
    const instances: Instance[] = [];
    const incomplete: string[] = [];

    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith('-output')) {
            continue;
        }
        const vscOutput = join(root, entry.name, 'output', 'vsc-output');
        const sqlitePath = join(vscOutput, 'session.sqlite');
        const name = entry.name.replace(/-output$/, '');
        if (!existsSync(sqlitePath)) {
            incomplete.push(name);
            continue;
        }
        instances.push({
            name,
            vscOutput,
            sqlitePath,
            configPath: join(vscOutput, 'configs', 'final-agent-config.json'),
            evalJsonPath: join(vscOutput, 'eval.json'),
        });
    }
    return { instances: instances.sort((a, b) => a.name.localeCompare(b.name)), incomplete };
}
