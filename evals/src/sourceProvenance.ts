/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';

/**
 * Paths whose contents change what a run actually measures: the evaluator itself, the product
 * agent assets it drives, and the extension source they share.
 */
export const provenancePaths = ['evals', 'resources', 'src'] as const;

export const allowDirtyEnvironmentVariable = 'COR_EVAL_ALLOW_DIRTY_SOURCE';

export interface SourceProvenance {
    commit: string;
    dirty: boolean;
    dirtyPaths: string[];
}

export class DirtySourceError extends Error {
    public constructor(public readonly provenance: SourceProvenance) {
        super(
            `Refusing to start: ${provenance.dirtyPaths.length} tracked file(s) under `
            + `${provenancePaths.join('/, ')}/ differ from ${provenance.commit.slice(0, 8)}, so the run would `
            + 'record a commit it did not execute. Commit or stash them, or set '
            + `${allowDirtyEnvironmentVariable}=true to accept unreproducible results.\n`
            + provenance.dirtyPaths.slice(0, 20).map(value => `  ${value}`).join('\n'),
        );
    }
}

function git(repoRoot: string, args: string[]): string {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

export function readSourceProvenance(repoRoot: string): SourceProvenance {
    const commit = git(repoRoot, ['rev-parse', 'HEAD']);
    const status = git(repoRoot, ['status', '--porcelain', '--', ...provenancePaths]);
    const dirtyPaths = status
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        // Porcelain lines are "XY path"; renames use "old -> new" and only the destination matters.
        .map(line => line.slice(line.indexOf(' ') + 1).trim())
        .map(value => value.includes(' -> ') ? value.slice(value.indexOf(' -> ') + 4) : value);
    return { commit, dirty: dirtyPaths.length > 0, dirtyPaths };
}

/**
 * A long matrix that reads its sources through tsx recompiles them on every import, so editing
 * during a run silently mixes revisions into one reported result. Fail before spending model and
 * sandbox capacity on numbers nobody can reproduce.
 */
export function assertReproducibleSource(repoRoot: string): SourceProvenance {
    const provenance = readSourceProvenance(repoRoot);
    if (provenance.dirty && process.env[allowDirtyEnvironmentVariable] !== 'true') {
        throw new DirtySourceError(provenance);
    }
    return provenance;
}
