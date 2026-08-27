/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which packages a scaffolded workspace contains, and whether it is coherent enough to build.
 *
 * This is the offline half of `evals/graders/validate-project-builds.ts`. The half that runs
 * `npm ci` needs a network and several minutes, so it cannot join the offline certification
 * tier — but the decisions *around* it can, and those are where this grader has actually gone
 * wrong. Discovery once used an allow-list of folder names and reported "no package.json
 * anywhere" for a complete project that simply used `api/`, and the frontend requirement
 * reported a plan-compliant scaffold as missing because directory discovery could not see a
 * root-level `web/`. Both were verdicts about locating code, not about building it, and both
 * are certifiable without installing anything.
 */

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { discoverFrontendDirectory } from './frontendScaffold.ts';
import { type ArtifactValidationIssue, type ArtifactValidationResult, createValidationResult } from './validationTypes.ts';

const IGNORED_DIRECTORIES = new Set([
    'node_modules', 'dist', 'build', '.git', '.next', 'out', 'coverage', '.azure',
    '.github', '.vscode', 'infra', 'migrations', 'docs', 'public', 'test', 'tests', '__tests__',
]);

/** How deep below the workspace root a package.json is still considered part of the project. */
const MAX_DEPTH = 2;

export interface ProjectPackage {
    directory: string;
    relative: string;
    scripts: Record<string, string>;
    /** True when this package delegates to npm workspaces, so its children run themselves. */
    delegatesToWorkspaces: boolean;
}

export interface PackageDiscovery {
    packages: ProjectPackage[];
    /** Workspace-relative paths of manifests that exist but could not be parsed. */
    unparseable: string[];
}

/**
 * Collect the workspace's buildable packages by walking the tree to a shallow depth.
 *
 * An allow-list of folder names ('services', 'apps', …) cannot work here: the agent picks
 * the layout from the plan, and a perfectly good API-only scaffold puts everything in
 * `api/`. Missing it made this grader report "no package.json anywhere" for a project that
 * was actually complete, so discovery walks instead of guessing names.
 */
export function discoverPackages(workspaceRoot: string): PackageDiscovery {
    const packages: ProjectPackage[] = [];
    const unparseable: string[] = [];

    const walk = (directory: string, depth: number): void => {
        const manifest = path.join(directory, 'package.json');
        if (existsSync(manifest)) {
            let parsed: { scripts?: Record<string, string>; workspaces?: unknown } | undefined;
            try {
                parsed = JSON.parse(readFileSync(manifest, 'utf8')) as typeof parsed;
            } catch {
                unparseable.push(path.relative(workspaceRoot, manifest).split(path.sep).join('/') || 'package.json');
            }
            if (parsed) {
                packages.push({
                    directory,
                    relative: path.relative(workspaceRoot, directory) || '.',
                    scripts: parsed.scripts ?? {},
                    delegatesToWorkspaces: parsed.workspaces !== undefined,
                });
            }
        }
        if (depth >= MAX_DEPTH) {
            return;
        }
        for (const entry of readdirSafe(directory)) {
            if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
                walk(path.join(directory, entry.name), depth + 1);
            }
        }
    };

    walk(workspaceRoot, 0);
    return { packages, unparseable };
}

function readdirSafe(directory: string): Dirent[] {
    try {
        return readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }
}

export interface ProjectPackagesOptions {
    /** The plan promised a frontend, so one must be present and findable. */
    requireFrontend?: boolean;
}

/**
 * Everything the build grader can decide before it installs anything.
 *
 * A clean result here does not mean the project builds — it means there is a project to
 * build and it contains what the plan promised.
 */
export async function validateProjectPackages(
    workspaceRoot: string,
    options: ProjectPackagesOptions = {},
): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];
    const { packages, unparseable } = discoverPackages(workspaceRoot);

    for (const manifest of unparseable) {
        issues.push({
            code: 'unparseablePackageManifest',
            path: manifest,
            message: `${manifest} is not valid JSON, so the project cannot be built.`,
        });
    }

    if (packages.length === 0) {
        issues.push({
            code: 'noPackagesFound',
            path: '.',
            message: 'The scaffold produced no package.json anywhere in the workspace, so there is no project to build.',
        });
    }

    if (options.requireFrontend && await discoverFrontendDirectory(workspaceRoot) === undefined) {
        issues.push({
            code: 'frontendNotScaffolded',
            path: '.',
            message: 'The plan promised a frontend, but no frontend package was scaffolded.',
        });
    }

    return createValidationResult(issues);
}
