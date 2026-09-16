/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reads the *shipped* agent definition under `resources/agents/`.
 *
 * This is the half of the old `executor/agent-assets.ts` that outlived the Vally
 * runner. The drift check needs it to know which files constitute the agent. The
 * SDK executor that owned the other half — building a workspace and a skill — has
 * since been deleted, and as that split anticipated, this module stayed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The instruction folder every agent may reference via relative links. */
export const SHARED_FOLDER = 'shared-references';

/**
 * Every asset the evals put in front of the agent: the `.agent.md` the skill is
 * generated from, plus the instruction folders copied into the workspace.
 *
 * The drift baseline hashes exactly this set. Hashing all of `resources/agents/**`
 * instead would fail the check whenever an unrelated agent moved on the base branch,
 * which on a pull request means unrelated commits break a suite they can't affect.
 *
 * Returns repo-relative paths (POSIX separators) sorted for a stable hash.
 */
export function listEvalAssetFiles(repoRoot: string, agentName: string): string[] {
    const sourceRoot = path.join(repoRoot, 'resources', 'agents');
    const roots = [`${agentName}.agent.md`, agentName, SHARED_FOLDER];
    const out: string[] = [];

    const walk = (relative: string): void => {
        const full = path.join(sourceRoot, relative);
        if (!fs.existsSync(full)) { return; }
        if (fs.statSync(full).isDirectory()) {
            for (const entry of fs.readdirSync(full)) { walk(path.join(relative, entry)); }
        } else {
            out.push(relative.split(path.sep).join('/'));
        }
    };

    for (const root of roots) { walk(root); }
    return out.sort();
}
