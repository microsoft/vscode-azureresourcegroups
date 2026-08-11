/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface EvaluationDefinitionProvenance {
    schemaVersion: '1';
    scenarioIds: string[];
    scenarioCorpusHash: string;
    evaluatorHash: string;
    productContractHash: string;
    combinedHash: string;
}

export interface EvaluationDefinitionEntry {
    path: string;
    content: string | Buffer;
}

// Hash the sources of generated Vally specs, not outputs that can stamp this definition hash.
const evaluatorInputs = [
    '.github/workflows/copilot-on-rails-evals.yml',
    '.vally.yaml',
    'evals/release-thresholds.v1.json',
    'evals/sandbox-dotnet.yaml',
    'evals/sandbox-python.yaml',
    'evals/sandbox.yaml',
    'evals/src',
    'evals/vally/eval.yaml',
    'evals/vally/oracle-custom-metrics.json',
    'evals/vally/native/generate.ts',
    'evals/vally/plugins',
    'evals/vscode-parity',
    'package-lock.json',
    'package.json',
] as const;

const productContractInputs = [
    'resources/agents',
    'src/utils/copilotOnRails/agentExecution',
    'src/webviews/copilotOnRails',
] as const;

export async function computeEvaluationDefinition(
    repoRoot: string,
    scenarioIds: string[],
): Promise<EvaluationDefinitionProvenance> {
    const normalizedScenarioIds = normalizeScenarioIds(scenarioIds);
    const [scenarioEntries, evaluatorEntries, productEntries] = await Promise.all([
        readInputs(repoRoot, normalizedScenarioIds.map(id => `evals/scenarios/${id}.json`)),
        readInputs(repoRoot, [...evaluatorInputs]),
        readInputs(repoRoot, [...productContractInputs]),
    ]);
    return createEvaluationDefinition(
        normalizedScenarioIds,
        scenarioEntries,
        evaluatorEntries,
        productEntries,
    );
}

export function createEvaluationDefinition(
    scenarioIds: string[],
    scenarioEntries: EvaluationDefinitionEntry[],
    evaluatorEntries: EvaluationDefinitionEntry[],
    productEntries: EvaluationDefinitionEntry[],
): EvaluationDefinitionProvenance {
    const normalizedScenarioIds = normalizeScenarioIds(scenarioIds);
    const scenarioCorpusHash = hashEvaluationDefinitionEntries(scenarioEntries);
    const evaluatorHash = hashEvaluationDefinitionEntries(evaluatorEntries);
    const productContractHash = hashEvaluationDefinitionEntries(productEntries);
    const combinedHash = combinedDefinitionHash(
        normalizedScenarioIds,
        scenarioCorpusHash,
        evaluatorHash,
        productContractHash,
    );
    return {
        schemaVersion: '1',
        scenarioIds: normalizedScenarioIds,
        scenarioCorpusHash,
        evaluatorHash,
        productContractHash,
        combinedHash,
    };
}

export function hashEvaluationDefinitionEntries(entries: EvaluationDefinitionEntry[]): string {
    const normalized = entries.map(entry => ({
        path: entry.path.replace(/\\/g, '/'),
        content: entry.content,
    })).sort((left, right) => compareText(left.path, right.path));
    const seen = new Set<string>();
    const hash = createHash('sha256');
    for (const entry of normalized) {
        if (!entry.path || seen.has(entry.path)) {
            throw new Error(`Evaluation definition input path is empty or duplicated: "${entry.path}".`);
        }
        seen.add(entry.path);
        hash.update(entry.path);
        hash.update('\0');
        hash.update(entry.content);
        hash.update('\0');
    }
    if (!normalized.length) {
        throw new Error('Evaluation definition inputs must not be empty.');
    }
    return `sha256:${hash.digest('hex')}`;
}

export function sameEvaluationDefinition(
    left: EvaluationDefinitionProvenance,
    right: EvaluationDefinitionProvenance,
): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.combinedHash === right.combinedHash
        && left.scenarioCorpusHash === right.scenarioCorpusHash
        && left.evaluatorHash === right.evaluatorHash
        && left.productContractHash === right.productContractHash
        && JSON.stringify(left.scenarioIds) === JSON.stringify(right.scenarioIds);
}

export function isEvaluationDefinitionProvenance(
    value: unknown,
): value is EvaluationDefinitionProvenance {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Partial<EvaluationDefinitionProvenance>;
    const normalizedScenarioIds = Array.isArray(candidate.scenarioIds)
        ? [...new Set(candidate.scenarioIds)].sort()
        : [];
    return candidate.schemaVersion === '1'
        && Array.isArray(candidate.scenarioIds)
        && candidate.scenarioIds.length > 0
        && candidate.scenarioIds.every(id =>
            typeof id === 'string' && /^[a-z0-9][a-z0-9-]+$/.test(id))
        && JSON.stringify(candidate.scenarioIds) === JSON.stringify(normalizedScenarioIds)
        && isHash(candidate.scenarioCorpusHash)
        && isHash(candidate.evaluatorHash)
        && isHash(candidate.productContractHash)
        && isHash(candidate.combinedHash)
        && candidate.combinedHash === combinedDefinitionHash(
            normalizedScenarioIds,
            candidate.scenarioCorpusHash,
            candidate.evaluatorHash,
            candidate.productContractHash,
        );
}

async function readInputs(repoRoot: string, relativePaths: string[]): Promise<EvaluationDefinitionEntry[]> {
    const entries: EvaluationDefinitionEntry[] = [];
    for (const relativePath of relativePaths) {
        const absolutePath = path.join(repoRoot, relativePath);
        let stat;
        try {
            stat = await fs.stat(absolutePath);
        } catch (error) {
            throw new Error(`Evaluation definition input is unavailable: ${relativePath}`, { cause: error });
        }
        if (stat.isDirectory()) {
            entries.push(...await readDirectory(repoRoot, absolutePath));
        } else if (stat.isFile()) {
            entries.push({
                path: toRepoPath(repoRoot, absolutePath),
                content: await fs.readFile(absolutePath),
            });
        }
    }
    return entries;
}

async function readDirectory(repoRoot: string, directory: string): Promise<EvaluationDefinitionEntry[]> {
    const names = (await fs.readdir(directory, { withFileTypes: true }))
        .sort((left, right) => compareText(left.name, right.name));
    const entries: EvaluationDefinitionEntry[] = [];
    for (const name of names) {
        const absolutePath = path.join(directory, name.name);
        if (name.isDirectory()) {
            entries.push(...await readDirectory(repoRoot, absolutePath));
        } else if (name.isFile()) {
            entries.push({
                path: toRepoPath(repoRoot, absolutePath),
                content: await fs.readFile(absolutePath),
            });
        }
    }
    return entries;
}

function normalizeScenarioIds(scenarioIds: string[]): string[] {
    const normalized = [...new Set(scenarioIds)].sort();
    if (!normalized.length || normalized.some(id => !/^[a-z0-9][a-z0-9-]+$/.test(id))) {
        throw new Error('Evaluation definition requires one or more kebab-case scenario IDs.');
    }
    if (normalized.length !== scenarioIds.length) {
        throw new Error('Evaluation definition scenario IDs must not contain duplicates.');
    }
    return normalized;
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
    const relativePath = path.relative(repoRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Evaluation definition input is outside the repository: ${absolutePath}`);
    }
    return relativePath.replace(/\\/g, '/');
}

function hashText(value: string): string {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function combinedDefinitionHash(
    scenarioIds: string[],
    scenarioCorpusHash: string,
    evaluatorHash: string,
    productContractHash: string,
): string {
    return hashText(JSON.stringify({
        schemaVersion: '1',
        scenarioIds,
        scenarioCorpusHash,
        evaluatorHash,
        productContractHash,
    }));
}

function isHash(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
