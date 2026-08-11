/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
    EvaluationDefinitionProvenance,
    computeEvaluationDefinition,
    createEvaluationDefinition,
} from '../../evals/src/evaluationDefinition';
import { collectMatrixEvaluationDefinitions } from '../../evals/src/matrix';
import {
    EvaluationAttempt,
    EvaluationSummary,
    createReport,
    renderMarkdown,
} from '../../evals/src/report';
import { CorEvaluationScenario } from '../../evals/src/scenario';

const model = 'definition-test-model';

suite('Evaluation definition provenance', () => {
    test('is stable across input order and changes for every definition component', () => {
        const first = definition('scenario source', 'evaluator source', 'product source', true);
        const reordered = definition('scenario source', 'evaluator source', 'product source', false);
        assert.deepEqual(first, reordered);

        const scenarioChanged = definition('changed scenario', 'evaluator source', 'product source');
        const evaluatorChanged = definition('scenario source', 'changed evaluator', 'product source');
        const productChanged = definition('scenario source', 'evaluator source', 'changed product');
        assert.notEqual(first.scenarioCorpusHash, scenarioChanged.scenarioCorpusHash);
        assert.notEqual(first.evaluatorHash, evaluatorChanged.evaluatorHash);
        assert.notEqual(first.productContractHash, productChanged.productContractHash);
        assert.notEqual(first.combinedHash, scenarioChanged.combinedHash);
        assert.notEqual(first.combinedHash, evaluatorChanged.combinedHash);
        assert.notEqual(first.combinedHash, productChanged.combinedHash);
    });

    test('deterministically hashes the checked-out runtime and selected scenario corpus', async () => {
        const first = await computeEvaluationDefinition(process.cwd(), ['api-ts-functions-minimal']);
        const second = await computeEvaluationDefinition(process.cwd(), ['api-ts-functions-minimal']);
        const differentScenario = await computeEvaluationDefinition(process.cwd(), ['api-python-flask-blob']);
        assert.deepEqual(first, second);
        assert.match(first.combinedHash, /^sha256:[0-9a-f]{64}$/);
        assert.notEqual(first.scenarioCorpusHash, differentScenario.scenarioCorpusHash);
        assert.equal(first.evaluatorHash, differentScenario.evaluatorHash);
        assert.equal(first.productContractHash, differentScenario.productContractHash);
    });

    test('excludes generated Vally specs but includes their generator and plugins', async () => {
        const resultsRoot = path.resolve('evals/results');
        await fs.mkdir(resultsRoot, { recursive: true });
        const fixtureRoot = await fs.mkdtemp(path.join(resultsRoot, 'evaluation-definition-test-'));
        try {
            await writeEvaluationDefinitionFixture(fixtureRoot);
            const original = await computeEvaluationDefinition(fixtureRoot, ['scenario']);

            await writeFixtureFiles(fixtureRoot, {
                'evals/vally/native/authoritative.eval.yaml':
                    `metadata:\n  evaluationDefinitionHash: ${original.combinedHash}\n`,
                'evals/vally/native/experiments/release.experiment.yaml':
                    `environment:\n  EVALUATION_DEFINITION_HASH: ${original.combinedHash}\n`,
                'evals/results/latest/report.json':
                    `${JSON.stringify({ evaluationDefinitionHash: original.combinedHash })}\n`,
            });
            const afterFirstGeneration = await computeEvaluationDefinition(fixtureRoot, ['scenario']);

            await writeFixtureFiles(fixtureRoot, {
                'evals/vally/native/authoritative.eval.yaml':
                    `metadata:\n  evaluationDefinitionHash: regenerated-${afterFirstGeneration.combinedHash}\n`,
                'evals/vally/native/experiments/release.experiment.yaml':
                    `environment:\n  EVALUATION_DEFINITION_HASH: regenerated-${afterFirstGeneration.combinedHash}\n`,
            });
            const afterRegeneration = await computeEvaluationDefinition(fixtureRoot, ['scenario']);
            assert.deepEqual(afterFirstGeneration, original);
            assert.deepEqual(afterRegeneration, original);

            await writeFixtureFiles(fixtureRoot, {
                'evals/vally/native/generate.ts': 'export const generatorVersion = 2;\n',
            });
            const generatorChanged = await computeEvaluationDefinition(fixtureRoot, ['scenario']);
            assert.notEqual(generatorChanged.evaluatorHash, original.evaluatorHash);
            assert.notEqual(generatorChanged.combinedHash, original.combinedHash);

            await writeFixtureFiles(fixtureRoot, {
                'evals/vally/native/generate.ts': 'export const generatorVersion = 1;\n',
                'evals/vally/plugins/cor-graders/index.ts': 'export const pluginVersion = 2;\n',
            });
            const pluginChanged = await computeEvaluationDefinition(fixtureRoot, ['scenario']);
            assert.notEqual(pluginChanged.evaluatorHash, original.evaluatorHash);
            assert.notEqual(pluginChanged.combinedHash, original.combinedHash);
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
        }
    });

    test('requires stable modern provenance during matrix aggregation', () => {
        const current = definition('scenario source', 'evaluator source', 'product source');
        const changed = definition('changed scenario', 'evaluator source', 'product source');
        const summaries = [
            summary('rails', [attempt('rails-1', 1, 'rails', current)], current),
            summary('rails', [attempt('rails-2', 2, 'rails', current)], current),
        ];
        assert.deepEqual(
            collectMatrixEvaluationDefinitions(summaries, 'rails', model),
            [current],
        );
        assert.throws(
            () => collectMatrixEvaluationDefinitions([
                summaries[0],
                summary('rails', [attempt('rails-2', 2, 'rails', changed)], changed),
            ], 'rails', model),
            /changed evaluation definition between attempts/,
        );
    });

    test('rejects modern paired mismatches but keeps legacy reports readable', () => {
        const current = definition('scenario source', 'evaluator source', 'product source');
        const changed = definition('scenario source', 'changed evaluator', 'product source');
        const rails = summary('rails', [attempt('rails', 1, 'rails', current)], current);
        const baseline = summary(
            'baseline-controlled',
            [attempt('baseline', 1, 'baseline-controlled', current)],
            current,
        );
        const modernReport = createReport([rails], [scenario()], [baseline]);
        assert.equal(
            modernReport.baselineComparison?.evaluationDefinitionProvenance.parity,
            'verified',
        );
        assert.equal(
            modernReport.releaseGates?.results.find(gate =>
                gate.id === 'evaluation-definition-provenance')?.status,
            'passed',
        );
        assert.match(renderMarkdown(modernReport), /Evaluation-definition parity: \*\*verified\*\*/);
        assert.match(renderMarkdown(modernReport), new RegExp(current.combinedHash));
        assert.throws(
            () => createReport(
                [rails],
                [scenario()],
                [summary(
                    'baseline-controlled',
                    [attempt('baseline', 1, 'baseline-controlled', changed)],
                    changed,
                )],
            ),
            /evaluation definition mismatch/,
        );
        assert.throws(
            () => createReport([rails], [scenario()], [withoutDefinition(baseline)]),
            /evaluation definition mismatch.*legacy_missing/,
        );

        const legacyRails = withoutDefinition(rails);
        const legacyBaseline = withoutDefinition(baseline);
        const legacyReport = createReport([legacyRails], [scenario()], [legacyBaseline]);
        assert.equal(legacyReport.evaluationDefinitionProvenance.status, 'legacy_missing');
        assert.equal(
            legacyReport.releaseGates?.results.find(gate =>
                gate.id === 'evaluation-definition-provenance')?.status,
            'missing_evidence',
        );
    });
});

function definition(
    scenarioContent: string,
    evaluatorContent: string,
    productContent: string,
    forward = true,
): EvaluationDefinitionProvenance {
    const scenarioEntries = [
        { path: 'evals/scenarios/scenario.json', content: scenarioContent },
        { path: 'evals/scenarios/metadata.json', content: 'metadata' },
    ];
    return createEvaluationDefinition(
        ['scenario'],
        forward ? scenarioEntries : [...scenarioEntries].reverse(),
        [{ path: 'evals/src/run.ts', content: evaluatorContent }],
        [{ path: 'resources/agents/agent.md', content: productContent }],
    );
}

function summary(
    arm: 'rails' | 'baseline-controlled',
    results: EvaluationAttempt[],
    evaluationDefinition: EvaluationDefinitionProvenance,
): EvaluationSummary {
    return {
        candidateCommit: 'candidate',
        agentAssetsHash: arm === 'rails' ? 'assets' : 'not-applicable:baseline-controlled',
        evaluationDefinitions: [evaluationDefinition],
        through: 'scaffold',
        evaluationArm: arm,
        requestedModel: arm === 'baseline-controlled' ? model : undefined,
        requestedModels: arm === 'rails' ? [model] : undefined,
        observedModels: [model],
        results,
    };
}

function attempt(
    runId: string,
    attemptNumber: number,
    arm: 'rails' | 'baseline-controlled',
    evaluationDefinition: EvaluationDefinitionProvenance,
): EvaluationAttempt {
    return {
        evaluationArm: arm,
        runId,
        scenarioId: 'scenario',
        attempt: attemptNumber,
        outcome: 'autonomous_success',
        candidateCommit: 'candidate',
        agentAssetsHash: arm === 'rails' ? 'assets' : 'not-applicable:baseline-controlled',
        evaluationDefinition,
        model,
        requestedModel: model,
        observedModels: [model],
        durationMs: 100,
        agentRetries: 0,
        stages: [{
            name: 'scaffold',
            agentRun: {
                outcome: 'completed',
                usage: { totalNanoAiu: 100, models: [model] },
            },
        }],
    };
}

function withoutDefinition(summaryValue: EvaluationSummary): EvaluationSummary {
    return {
        ...summaryValue,
        evaluationDefinitions: undefined,
        results: summaryValue.results.map(value => ({
            ...value,
            evaluationDefinition: undefined,
        })),
    };
}

function scenario(): CorEvaluationScenario {
    return {
        schemaVersion: '1',
        id: 'scenario',
        prompt: 'Build an API.',
        baselinePrompt: 'Build a complete standalone API with source, configuration, tests, local debugging support, and deployment-ready infrastructure.',
        tags: { archetype: 'api' },
        validation: {
            profile: 'minimal',
            build: true,
            test: true,
            lint: 'required',
            timeoutMinutes: 5,
        },
    };
}

async function writeEvaluationDefinitionFixture(repoRoot: string): Promise<void> {
    await writeFixtureFiles(repoRoot, {
        '.github/workflows/copilot-on-rails-evals.yml': 'name: fixture\n',
        '.vally.yaml': 'paths: {}\n',
        'evals/release-thresholds.v1.json': '{}\n',
        'evals/sandbox-dotnet.yaml': 'name: dotnet\n',
        'evals/sandbox-python.yaml': 'name: python\n',
        'evals/sandbox.yaml': 'name: default\n',
        'evals/scenarios/scenario.json': '{"id":"scenario"}\n',
        'evals/src/evaluator.ts': 'export const evaluatorVersion = 1;\n',
        'evals/vally/eval.yaml': 'name: static-contract\n',
        'evals/vally/oracle-custom-metrics.json': '{}\n',
        'evals/vally/native/generate.ts': 'export const generatorVersion = 1;\n',
        'evals/vally/plugins/cor-graders/index.ts': 'export const pluginVersion = 1;\n',
        'evals/vally/plugins/cor-graders/package.json': '{"name":"fixture-plugin"}\n',
        'evals/vscode-parity/package.json': '{"name":"fixture-parity"}\n',
        'evals/vscode-parity/test.js': 'module.exports = {};\n',
        'package-lock.json': '{}\n',
        'package.json': '{}\n',
        'resources/agents/agent.md': 'agent contract\n',
        'src/utils/copilotOnRails/agentExecution/contract.ts': 'export {};\n',
        'src/webviews/copilotOnRails/contract.ts': 'export {};\n',
    });
}

async function writeFixtureFiles(repoRoot: string, files: Record<string, string>): Promise<void> {
    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = path.join(repoRoot, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content);
    }));
}
