/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reads the *shipped* agent definition under `resources/agents/`.
 *
 * This is the half of the old `executor/agent-assets.mjs` that outlives the Vally
 * runner. The drift check needs it to know which files constitute the agent and
 * which models the product declares support for; the executor needs it to build a
 * workspace and a skill. Splitting on that line keeps the drift check free of the
 * MCP tool table — and when the SDK executor is deleted, this module stays.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The instruction folder every agent may reference via relative links. */
export const SHARED_FOLDER = 'shared-references';

/**
 * Maps the VS Code display names in the agent front-matter `model:` list to the
 * bare Copilot (CAPI) model ids the SDK accepts. Extend this when the product
 * adds a supported model; an unmapped entry fails the run rather than silently
 * narrowing what the evals consider supported.
 */
const MODEL_DISPLAY_NAME_TO_ID = new Map<string, string>([
    ['Claude Opus 4.6 (copilot)', 'claude-opus-4.6'],
    ['Claude Opus 4.7 (copilot)', 'claude-opus-4.7'],
    ['Claude Sonnet 4.6 (copilot)', 'claude-sonnet-4.6'],
]);

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

/** Split `---`-delimited YAML front-matter from a markdown body. */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
    if (!match) { return { frontmatter: '', body: markdown }; }
    return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

/**
 * Pull a scalar key out of front-matter. Only `name` and `description` are needed,
 * and both are single-line in the shipped agent files.
 */
export function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
    const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter);
    if (!match) { return undefined; }
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return value.replace(/\\"/g, '"');
}

/** Read the front-matter of the shipped `<agent>.agent.md`, or throw if it's missing. */
function readAgentFile(repoRoot: string, agentName: string): { agentFile: string; frontmatter: string; body: string } {
    const agentFile = path.join(repoRoot, 'resources', 'agents', `${agentName}.agent.md`);
    if (!fs.existsSync(agentFile)) {
        throw new Error(`Cannot read agent assets: ${agentFile} does not exist`);
    }
    return { agentFile, ...splitFrontmatter(fs.readFileSync(agentFile, 'utf8')) };
}

/**
 * The models the shipped agent declares support for, as SDK model ids.
 *
 * Read from the agent's own `model:` front-matter so the harness can never grade
 * a model the product doesn't ship the agent on — and so removing a model from
 * the product removes it from the evals too.
 */
export function readSupportedModels(repoRoot: string, agentName: string): string[] {
    const { agentFile, frontmatter } = readAgentFile(repoRoot, agentName);
    const raw = readFrontmatterValue(frontmatter, 'model');
    if (!raw) {
        throw new Error(`Cannot resolve eval model: ${agentFile} has no frontmatter 'model' list`);
    }

    // `model: ['A (copilot)', 'B (copilot)']` — a single-line flow sequence in every shipped agent.
    const displayNames = raw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(entry => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);

    if (displayNames.length === 0) {
        throw new Error(`Cannot resolve eval model: ${agentFile} declares an empty 'model' list`);
    }

    return displayNames.map(displayName => {
        const id = MODEL_DISPLAY_NAME_TO_ID.get(displayName);
        if (!id) {
            throw new Error(
                `Cannot resolve eval model: ${agentFile} lists '${displayName}', which has no SDK id mapping. ` +
                `Add it to MODEL_DISPLAY_NAME_TO_ID in evals/src/agent-definition.ts.`,
            );
        }
        return id;
    });
}
