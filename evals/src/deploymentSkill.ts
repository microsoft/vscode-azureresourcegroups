/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);

/**
 * `azure-deploy.agent.md` treats `.agents/skills/azure-prepare/SKILL.md` as its mandatory
 * operating manual. Users get that skill from the Azure plugin, so an evaluation without it
 * would measure a missing dependency rather than the product. It is fetched into the
 * ephemeral workspace at a pinned commit instead of being vendored, so the evaluation tracks
 * the real dependency and every run can state exactly which revision it graded.
 */
export const azurePrepareRepository = 'microsoft/azure-skills';
export const azurePrepareSkillPath = 'skills/azure-prepare';
const workspaceSkillPath = path.join('.agents', 'skills', 'azure-prepare');

export interface DeploymentSkillProvenance {
    repository: string;
    ref: string;
    commit: string;
    skillPath: string;
}

export class DeploymentSkillUnavailableError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'DeploymentSkillUnavailableError';
    }
}

export interface DeploymentSkillOptions {
    cacheRoot: string;
    ref?: string;
    fetcher?: DeploymentSkillFetcher;
}

export interface DeploymentSkillFetcher {
    resolveCommit(repository: string, ref: string): Promise<string>;
    download(repository: string, commit: string, destination: string): Promise<void>;
}

/**
 * Resolving the ref to a commit keeps the evidence reproducible even when the upstream
 * default branch moves between runs.
 */
export async function ensureDeploymentSkill(
    workspace: string,
    options: DeploymentSkillOptions,
): Promise<DeploymentSkillProvenance> {
    const ref = options.ref ?? 'main';
    const fetcher = options.fetcher ?? createGitHubDeploymentSkillFetcher();
    let commit: string;
    try {
        commit = await fetcher.resolveCommit(azurePrepareRepository, ref);
    } catch (error) {
        throw new DeploymentSkillUnavailableError(
            `Could not resolve ${azurePrepareRepository}@${ref}: ${describe(error)}`,
        );
    }
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
        throw new DeploymentSkillUnavailableError(
            `Resolved an unexpected commit for ${azurePrepareRepository}@${ref}: ${commit}`,
        );
    }
    const cached = path.join(options.cacheRoot, commit);
    if (!await exists(path.join(cached, 'SKILL.md'))) {
        await fs.rm(cached, { recursive: true, force: true });
        try {
            await fetcher.download(azurePrepareRepository, commit, cached);
        } catch (error) {
            await fs.rm(cached, { recursive: true, force: true });
            throw new DeploymentSkillUnavailableError(
                `Could not download ${azurePrepareRepository}@${commit}: ${describe(error)}`,
            );
        }
    }
    if (!await exists(path.join(cached, 'SKILL.md'))) {
        throw new DeploymentSkillUnavailableError(
            `${azurePrepareSkillPath}/SKILL.md was missing from ${azurePrepareRepository}@${commit}.`,
        );
    }
    const destination = path.join(workspace, workspaceSkillPath);
    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(cached, destination, { recursive: true, force: true });
    return { repository: azurePrepareRepository, ref, commit, skillPath: workspaceSkillPath };
}

function createGitHubDeploymentSkillFetcher(): DeploymentSkillFetcher {
    return {
        resolveCommit: async (repository, ref) => {
            const { stdout } = await run('gh', ['api', `repos/${repository}/commits/${ref}`, '--jq', '.sha']);
            return stdout.trim();
        },
        download: async (repository, commit, destination) => {
            const staging = `${destination}.staging`;
            await fs.rm(staging, { recursive: true, force: true });
            await fs.mkdir(staging, { recursive: true });
            try {
                // A sparse archive keeps the download to the single skill folder rather than
                // the whole skills monorepo.
                await run('sh', [
                    '-c',
                    `gh api repos/${repository}/tarball/${commit} `
                    + `| tar -xz -C ${JSON.stringify(staging)} --strip-components=3 `
                    + `'*/${azurePrepareSkillPath}'`,
                ]);
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.rename(staging, destination);
            } finally {
                await fs.rm(staging, { recursive: true, force: true });
            }
        },
    };
}

async function exists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
