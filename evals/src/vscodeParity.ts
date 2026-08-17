/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { SandboxVsCodeParityValidator } from './SandboxVsCodeParityValidator';
import { loadScenarios } from './scenario';
import {
    EvaluationDefinitionProvenance,
    isEvaluationDefinitionProvenance,
    sameEvaluationDefinition,
} from './evaluationDefinition';

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const inputDirectory = path.resolve(options.input);
    const summary = JSON.parse(await fs.readFile(path.join(inputDirectory, 'summary.json'), 'utf8')) as {
        evaluationArm?: string;
        through?: string;
        candidateCommit?: string;
        agentAssetsHash?: string;
        evaluationDefinitions?: EvaluationDefinitionProvenance[];
        requestedModels?: string[];
        results: {
            evaluationArm?: string;
            runId: string;
            scenarioId: string;
            attempt: number;
            outcome: string;
            candidateCommit?: string;
            agentAssetsHash?: string;
            evaluationDefinition?: EvaluationDefinitionProvenance;
            requestedModel?: string;
            observedModels?: string[];
        }[];
    };
    if (summary.results.length !== 1) {
        throw new Error(`VS Code parity requires exactly one evaluation result; found ${summary.results.length}.`);
    }
    const source = summary.results[0];
    if (summary.evaluationArm !== 'rails' || source.evaluationArm !== 'rails') {
        throw new Error('VS Code parity requires a declared Rails treatment summary and attempt.');
    }
    if (summary.through !== 'local' || source.outcome !== 'autonomous_success') {
        throw new Error('VS Code parity requires a successful local-endpoint treatment attempt.');
    }
    const requestedModel = source.requestedModel
        ?? (summary.requestedModels?.length === 1 ? summary.requestedModels[0] : undefined);
    const observedModels = [...new Set(source.observedModels ?? [])].sort();
    if (!requestedModel || observedModels.length !== 1 || observedModels[0] !== requestedModel) {
        throw new Error('VS Code parity source model provenance is missing or does not match its explicit pin.');
    }
    if (!summary.candidateCommit || !summary.agentAssetsHash || !Number.isInteger(source.attempt)) {
        throw new Error('VS Code parity source commit, asset, or attempt provenance is missing.');
    }
    if (
        source.candidateCommit !== summary.candidateCommit
        || source.agentAssetsHash !== summary.agentAssetsHash
    ) {
        throw new Error('VS Code parity attempt commit or asset provenance conflicts with its summary.');
    }
    if (
        summary.evaluationDefinitions !== undefined
        && (!Array.isArray(summary.evaluationDefinitions)
            || summary.evaluationDefinitions.some(value =>
                !isEvaluationDefinitionProvenance(value))
            || !isEvaluationDefinitionProvenance(source.evaluationDefinition)
            || !summary.evaluationDefinitions.some(value =>
                sameEvaluationDefinition(value, source.evaluationDefinition as EvaluationDefinitionProvenance)))
    ) {
        throw new Error('VS Code parity source evaluation-definition provenance conflicts with its summary.');
    }
    const scenario = (await loadScenarios(path.join(repoRoot, 'evals', 'scenarios')))
        .find(value => value.id === source.scenarioId);
    if (!scenario) {
        throw new Error(`Unknown scenario "${source.scenarioId}".`);
    }
    if (!scenario.acceptance?.local?.debugParity) {
        throw new Error(`Scenario "${source.scenarioId}" has no VS Code parity contract.`);
    }
    const workspace = path.join(inputDirectory, source.runId, 'workspace');
    const debugPlan = await fs.readFile(path.join(workspace, '.azure', 'vscode-debug-plan.md'), 'utf8');
    const validation = await new SandboxVsCodeParityValidator(repoRoot).validate(workspace, scenario, debugPlan);
    const result = {
        ...validation,
        sourceProvenance: {
            evaluationArm: 'rails' as const,
            through: 'local' as const,
            runId: source.runId,
            scenarioId: source.scenarioId,
            attempt: source.attempt,
            candidateCommit: source.candidateCommit,
            agentAssetsHash: source.agentAssetsHash,
            evaluationDefinition: source.evaluationDefinition,
            requestedModel,
            observedModels,
            debugParity: scenario.acceptance.local.debugParity,
        },
    };
    const output = path.resolve(options.output);
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'vscode-parity-result.json'), JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(`VS Code parity ${result.outcome}: ${output}\n`);
    if (result.outcome === 'failed') {
        process.exitCode = 1;
    }
}

function parseArgs(args: string[]): { input: string; output: string } {
    let input = '';
    let output = path.join('evals', 'results', 'vscode-parity');
    for (let index = 0; index < args.length; index++) {
        switch (args[index]) {
            case '--input':
                input = requireValue(args, ++index, '--input');
                break;
            case '--output':
                output = requireValue(args, ++index, '--output');
                break;
            default:
                throw new Error(`Unknown argument "${args[index]}".`);
        }
    }
    if (!input) {
        throw new Error('--input is required.');
    }
    return { input, output };
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index];
    if (!value) {
        throw new Error(`${flag} requires a value.`);
    }
    return value;
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
