/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Where the harvested scaffold seed lives, and whether it is still current.
 *
 * This is the half of seed provenance that touches nothing but the filesystem, split out
 * from `harvest-seed.ts` for one concrete reason: harvesting reads a run's
 * `session.sqlite` and therefore imports `node:sqlite`, which is experimental and prints
 * a warning unless the process was started with `--disable-warning=ExperimentalWarning`.
 *
 * `stage-workspace.ts` needs to know where the seed is and where it came from, and
 * `run.sh` invokes it as a bare `node stage-workspace.ts`. Importing the harvester there
 * would put an experimental-runtime warning into the middle of every staged run's output
 * for a capability that step never uses. So the dependency is inverted: the cheap half
 * has no heavyweight imports, and the harvester builds on it.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MsBenchToolError } from './extraction.ts';

const HERE = import.meta.dirname;
const EVALS_ROOT = resolve(HERE, '..');

/**
 * Checked in, unlike `assets/`, because a seed only helps CI and other machines if it
 * travels with the repository. `assets/` is scratch space that `run.sh` owns and wipes.
 */
export const SEEDS_ROOT = join(HERE, 'seeds');

export const HARVESTED_PLAN = join(SEEDS_ROOT, 'project-plan.md');
export const PROVENANCE_PATH = join(SEEDS_ROOT, 'provenance.json');

/**
 * The lock already tracks exactly the scope that decides a plan's shape
 * (`azure-project-plan.agent.md, azure-project-plan/**, shared-references/**`) and is
 * already gated by `npm run drift`. Reading its published hash rather than recomputing
 * one here is deliberate: the lock *is* the contract, and a lock that were itself out of
 * date would already have turned `drift` red.
 */
const LOCK_PATH = join(EVALS_ROOT, 'agent-assets.lock.json');

/** The freshness vocabulary, and the exit code each state maps to. */
export const EXIT_FRESH = 0;
export const EXIT_STALE = 1;
export const EXIT_NOT_HARVESTED = 2;
export const EXIT_TOOL_ERROR = 3;

export interface Provenance {
    /** The MSBench run the document came out of. */
    runId: string;
    /** Which instance of that run, since a run may hold several. */
    instance: string;
    harvestedAt: string;
    /** `agentAssetsHash` from `evals/agent-assets.lock.json` when this was captured. */
    agentAssetsHash: string;
    /** The path inside the run's workspace, recorded so a later rename is visible. */
    sourcePath: string;
}

export type Freshness =
    | { state: 'fresh'; provenance: Provenance }
    | { state: 'stale'; provenance: Provenance; current: string }
    | { state: 'not-harvested' };

const REQUIRED_KEYS = ['runId', 'instance', 'harvestedAt', 'agentAssetsHash', 'sourcePath'] as const;

/**
 * The hash the lock publishes today.
 *
 * A missing or malformed lock is a tool error rather than a staleness verdict: it means
 * the check could not be performed, and reporting that as "fresh" is the exact collapse
 * the separate not-harvested state exists to avoid.
 */
export function currentAgentAssetsHash(): string {
    if (!existsSync(LOCK_PATH)) {
        throw new MsBenchToolError(
            `Cannot read ${LOCK_PATH}.\n` +
            'Seed freshness is defined against the agent-assets lock, so without it the check\n' +
            'has no baseline. Run `npm run drift -- --update` from evals/ to create one.'
        );
    }
    const parsed = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { agentAssetsHash?: unknown };
    if (typeof parsed.agentAssetsHash !== 'string' || parsed.agentAssetsHash.length === 0) {
        throw new MsBenchToolError(`${LOCK_PATH} has no usable "agentAssetsHash".`);
    }
    return parsed.agentAssetsHash;
}

export function readProvenance(): Provenance | null {
    if (!existsSync(PROVENANCE_PATH)) {
        return null;
    }
    const parsed = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) as Partial<Provenance>;
    for (const key of REQUIRED_KEYS) {
        const value = parsed[key];
        if (typeof value !== 'string' || value.length === 0) {
            throw new MsBenchToolError(
                `${PROVENANCE_PATH} is missing "${key}".\n` +
                'A provenance file that cannot be read is not the same as no provenance at all —\n' +
                're-harvest rather than deleting it, so the seed keeps an auditable origin.'
            );
        }
    }
    return parsed as Provenance;
}

export function writeSeed(content: string, provenance: Provenance): void {
    mkdirSync(SEEDS_ROOT, { recursive: true });
    writeFileSync(HARVESTED_PLAN, content);
    writeFileSync(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 4)}\n`);
}

export function checkFreshness(): Freshness {
    const provenance = readProvenance();
    if (!provenance) {
        return { state: 'not-harvested' };
    }
    // A provenance file with no document beside it is a half-finished harvest, and the
    // seed it claims to describe does not exist. Treat that as a tool error rather than
    // reporting a freshness verdict about a file that is not there.
    if (!existsSync(HARVESTED_PLAN)) {
        throw new MsBenchToolError(
            `${PROVENANCE_PATH} exists but ${HARVESTED_PLAN} does not.\n` +
            'Re-harvest to restore the pair; they are only meaningful together.'
        );
    }
    const current = currentAgentAssetsHash();
    return provenance.agentAssetsHash === current
        ? { state: 'fresh', provenance }
        : { state: 'stale', provenance, current };
}
