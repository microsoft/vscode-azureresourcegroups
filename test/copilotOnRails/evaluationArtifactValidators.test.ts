/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
    AcaCommandRunner,
    SandboxProjectValidator,
    canContinueAfterProjectValidationFailure,
    classifySandboxValidationCommand,
    createSandboxManifest,
    createWorkspaceArchive,
    discoverProjectValidationTargets,
    readSandboxId,
    readSandboxIds,
} from '../../evals/src/SandboxProjectValidator';
import {
    createAzureStorageSharedKeyAuthorization,
    createBlobStorageEventScript,
    createHttpProbeCommand,
    createProcessGroupTerminationCommand,
    createQueueStorageEventScript,
    debugpyEvaluationPort,
    parseLaunchedProcessId,
    resolveDebuggerPrerequisite,
    resolveLaunchTask,
    SandboxLocalRuntimeValidator,
} from '../../evals/src/SandboxLocalRuntimeValidator';
import {
    createParityCommand,
    parseParityEvidence,
} from '../../evals/src/SandboxVsCodeParityValidator';
import { validateIntegrationPlanArtifact } from '../../evals/src/artifacts/integrationPlan';
import { validateIntegrationOutput } from '../../evals/src/artifacts/integrationOutput';
import { validateDeploymentArtifacts } from '../../evals/src/artifacts/deployment';
import {
    applyLocalRuntimeEvidence,
    validateLocalDebugArtifacts,
    validateLocalDebugPlanArtifact,
} from '../../evals/src/artifacts/localDebug';
import { validatePlanEvaluationContract } from '../../evals/src/artifacts/planEvaluation';
import { validatePreviewArtifacts } from '../../evals/src/artifacts/preview';
import {
    confirmRequirementsArtifact,
    validateRequirementsArtifact,
} from '../../evals/src/artifacts/requirements';
import { validateProjectPlanArtifact } from '../../evals/src/artifacts/projectPlan';
import { CopilotSdkAgentExecutor } from '../../evals/src/CopilotSdkAgentExecutor';
import { classifyFailure, createReport, wilsonInterval } from '../../evals/src/report';
import { applyBuildRevalidation, applyLocalRevalidation } from '../../evals/src/revalidate';
import { countRepairStages, readSourceResult } from '../../evals/src/resumeLocal';
import {
    EvaluationStageResult,
    runIntegrationStages,
    runProjectValidationStages,
} from '../../evals/src/run';
import { createAgentRepairBudget } from '../../evals/src/evaluationParity';
import { loadScenarios, validateScenario } from '../../evals/src/scenario';
import { runLiveDeployment } from '../../evals/src/liveDeploy';
import {
    ProjectPlanStatus,
    replaceProjectPlanStatus,
    setProjectPlanExecutionMode,
} from '../../src/webviews/copilotOnRails/views/utils/projectPlanStatus';

const execFileAsync = promisify(execFile);

suite('Copilot on Rails evaluation artifact validators', () => {
    const fixtureRoot = path.resolve(__dirname, '..', '..', 'test', 'testProjects', 'copilotOnRails');

    for (const fixture of ['attendance', 'scrapbook']) {
        test(`accepts the ${fixture} requirements fixture`, async () => {
            const content = await fs.readFile(path.join(fixtureRoot, fixture, 'requirements.json'), 'utf8');
            const result = validateRequirementsArtifact(content, { requireConfirmed: true });
            assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
        });

        test(`accepts the ${fixture} project plan fixture`, async () => {
            const content = await fs.readFile(path.join(fixtureRoot, fixture, 'project-plan.md'), 'utf8');
            const result = validateProjectPlanArtifact(content);
            assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
        });
    }

    test('validates production local-debug plan fixtures', async () => {
        const implemented = await fs.readFile(path.join(fixtureRoot, 'attendance', 'vscode-debug-plan.md'), 'utf8');
        const implementedResult = validateLocalDebugPlanArtifact(implemented, {
            expectedStatus: 'Implemented',
            requireAutoMode: true,
            requireSuccessfulChecklist: true,
        });

        assert.equal(implementedResult.valid, true, JSON.stringify(implementedResult.issues, null, 2));

        const planning = await fs.readFile(path.join(fixtureRoot, 'scrapbook', 'vscode-debug-plan.md'), 'utf8');
        const planningResult = validateLocalDebugPlanArtifact(planning, { expectedStatus: 'Planning' });
        assert.equal(planningResult.valid, true, JSON.stringify(planningResult.issues, null, 2));

        const implementedFromEvidence = applyLocalRuntimeEvidence(
            planning.replace('**Execution Mode:** Guided', '**Execution Mode:** Auto'),
            {
                outcome: 'passed',
                commands: [],
                probes: [{
                    name: 'health endpoint',
                    target: 'backend',
                    method: 'GET',
                    url: 'http://127.0.0.1:7071/api/health',
                    expectedStatus: 200,
                    success: true,
                    durationMs: 1,
                    response: '{"status":"healthy"}',
                }],
            },
            '2026-08-06T00:00:00.000Z',
        );
        const evidenceResult = validateLocalDebugPlanArtifact(implementedFromEvidence, {
            expectedStatus: 'Implemented',
            requireAutoMode: true,
            requireSuccessfulChecklist: true,
        });
        assert.equal(evidenceResult.valid, true, JSON.stringify(evidenceResult.issues, null, 2));
    });

    test('validates deployment artifacts without provisioning Azure resources', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-deployment-contract-'));
        const plan = await fs.readFile(path.join(fixtureRoot, 'attendance', 'deployment-plan.md'), 'utf8');
        await fs.mkdir(path.join(workspace, 'api'), { recursive: true });
        await fs.mkdir(path.join(workspace, 'web'), { recursive: true });
        await fs.mkdir(path.join(workspace, 'infra'), { recursive: true });
        await fs.writeFile(path.join(workspace, 'infra', 'main.bicep'), 'targetScope = \'resourceGroup\'\n');
        await fs.writeFile(path.join(workspace, 'azure.yaml'), [
            'name: attendance',
            'services:',
            '  api:',
            '    project: api',
            '    host: function',
            '    language: ts',
            '  web:',
            '    project: web',
            '    host: staticwebapp',
            '    language: js',
            'hooks:',
            '  postprovision:',
            '    shell: sh',
            '    run: ./scripts/seed.sh',
            '',
        ].join('\n'));
        try {
            const result = await validateDeploymentArtifacts(workspace, plan);
            assert.equal(result.valid, true, JSON.stringify(result.issues));
            assert.deepEqual(result.serviceNames, ['api', 'web']);
            assert.equal(result.infrastructure, 'bicep');
            assert.equal(result.packageCommand, 'azd package');
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('gates live deployment and verifies cleanup evidence', async () => {
        const previous = process.env.COR_EVAL_ALLOW_LIVE_DEPLOYMENT;
        process.env.COR_EVAL_ALLOW_LIVE_DEPLOYMENT = 'true';
        const subscriptionId = '00000000-0000-0000-0000-000000000001';
        const calls: string[] = [];
        let resourceGroup = '';
        const scratchRoot = path.resolve(__dirname, '..', '..', 'evals', 'results');
        await fs.mkdir(scratchRoot, { recursive: true });
        const workspace = await fs.mkdtemp(path.join(scratchRoot, '.test-live-deployment-'));
        await fs.mkdir(path.join(workspace, '.azure'), { recursive: true });
        await fs.writeFile(path.join(workspace, '.azure', 'config.json'), '{"defaultEnvironment":"original"}\n');
        try {
            const result = await runLiveDeployment({
                workspace,
                subscriptionId,
                location: 'eastus2',
                enabled: true,
                sourceProvenance: {
                    evaluationArm: 'rails',
                    through: 'local',
                    runId: 'source-run',
                    scenarioId: 'api-ts-functions-minimal',
                    attempt: 1,
                    candidateCommit: 'abc123',
                    agentAssetsHash: 'assets123',
                    requestedModel: 'test-model',
                    observedModels: ['test-model'],
                },
            }, {
                run: async (command, args) => {
                    calls.push(`${command} ${args.join(' ')}`);
                    if (command === 'az' && args[0] === 'account') {
                        return { stdout: `${subscriptionId}\n`, stderr: '' };
                    }
                    if (command === 'azd' && args[0] === 'env' && args[1] === 'get-value') {
                        return { stdout: `${resourceGroup}\n`, stderr: '' };
                    }
                    if (command === 'azd' && args[0] === 'env' && args[1] === 'set' && args[2] === 'AZURE_RESOURCE_GROUP') {
                        resourceGroup = args[3];
                    }
                    if (command === 'az' && args[0] === 'resource') {
                        return { stdout: '[]', stderr: '' };
                    }
                    if (command === 'az' && args[0] === 'group' && args[1] === 'exists') {
                        return { stdout: 'false\n', stderr: '' };
                    }
                    if (command === 'az' && args[0] === 'group' && args[1] === 'list') {
                        return { stdout: '[]', stderr: '' };
                    }
                    return { stdout: '', stderr: '' };
                },
            });
            assert.equal(result.outcome, 'passed', result.error);
            assert.equal(result.cleanupVerified, true);
            assert(calls.some(value => value.startsWith('azd package')));
            assert(calls.some(value => value.startsWith('azd env set AZURE_RESOURCE_GROUP cor-eval-')));
            assert(calls.some(value => value.startsWith('azd down --force --purge --no-prompt')));
            assert(calls.some(value => value.startsWith('azd env remove cor-eval-')));
            assert.equal(result.sourceProvenance?.runId, 'source-run');
            assert.equal(
                await fs.readFile(path.join(workspace, '.azure', 'config.json'), 'utf8'),
                '{"defaultEnvironment":"original"}\n',
            );
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
            if (previous === undefined) {
                delete process.env.COR_EVAL_ALLOW_LIVE_DEPLOYMENT;
            } else {
                process.env.COR_EVAL_ALLOW_LIVE_DEPLOYMENT = previous;
            }
        }
    });

    test('validates generated VS Code debug artifacts and task graphs', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-debug-artifacts-'));
        try {
            const vscodeDirectory = path.join(workspace, '.vscode');
            await fs.mkdir(vscodeDirectory, { recursive: true });
            const plan = await fs.readFile(path.join(fixtureRoot, 'attendance', 'vscode-debug-plan.md'), 'utf8');
            await fs.writeFile(path.join(vscodeDirectory, 'launch.json'), JSON.stringify({
                version: '0.2.0',
                configurations: [
                    { name: 'Attendance API (debug)', preLaunchTask: 'attendance-api: start' },
                    { name: 'Attendance Web (debug)', preLaunchTask: 'attendance-web: start' },
                ],
                compounds: [{
                    name: 'Debug Full Stack',
                    configurations: ['Attendance API (debug)', 'Attendance Web (debug)'],
                }],
            }));
            await fs.writeFile(path.join(vscodeDirectory, 'tasks.json'), JSON.stringify({
                version: '2.0.0',
                tasks: [
                    {
                        label: 'Start Emulators',
                        command: 'docker compose up -d',
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                        problemMatcher: [],
                    },
                    {
                        label: 'attendance-api: install',
                        command: 'npm install',
                        options: { cwd: '$' + '{workspaceFolder}/services/api' },
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                        problemMatcher: [],
                    },
                    {
                        label: 'attendance-api: start',
                        command: 'npm run start',
                        options: { cwd: '$' + '{workspaceFolder}/services/api' },
                        dependsOn: ['Start Emulators', 'attendance-api: install'],
                        isBackground: true,
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                        problemMatcher: '$func-node-watch',
                    },
                    {
                        label: 'attendance-web: install',
                        command: 'npm ci',
                        options: { cwd: '$' + '{workspaceFolder}/services/web' },
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                        problemMatcher: [],
                    },
                    {
                        label: 'attendance-web: start',
                        command: 'npm run dev',
                        options: { cwd: '$' + '{workspaceFolder}/services/web' },
                        dependsOn: ['attendance-web: install'],
                        isBackground: true,
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                        problemMatcher: '$tsc-watch',
                    },
                ],
            }));
            await fs.writeFile(path.join(vscodeDirectory, 'extensions.json'), JSON.stringify({
                recommendations: ['ms-azuretools.vscode-azurefunctions'],
            }));
            await fs.writeFile(path.join(vscodeDirectory, 'settings.json'), '{}');
            const composePath = path.join(workspace, 'docker-compose.yml');
            await fs.writeFile(
                composePath,
                'services:\n  azurite:\n    image: mcr.microsoft.com/azure-storage/azurite\n    command: azurite --skipApiVersionCheck\n',
            );
            await fs.mkdir(path.join(workspace, 'api-test-collections', 'attendance-api', 'health'), { recursive: true });
            await fs.writeFile(path.join(workspace, 'api-test-collections', 'attendance-api', 'health', 'invoke.sh'), '#!/bin/sh\n');

            const valid = await validateLocalDebugArtifacts(workspace, plan);
            assert.equal(valid.valid, true, JSON.stringify(valid.issues, null, 2));

            const tasks = JSON.parse(await fs.readFile(path.join(vscodeDirectory, 'tasks.json'), 'utf8'));
            tasks.tasks[2].problemMatcher = [];
            await fs.writeFile(path.join(vscodeDirectory, 'tasks.json'), JSON.stringify(tasks));
            const invalid = await validateLocalDebugArtifacts(workspace, plan);
            assert.equal(invalid.valid, false);
            assert(invalid.issues.some(issue => issue.code === 'missingBackgroundProblemMatcher'));

            tasks.tasks[2].problemMatcher = '$func-node-watch';
            await fs.writeFile(path.join(vscodeDirectory, 'tasks.json'), JSON.stringify(tasks));
            await fs.writeFile(
                composePath,
                'services:\n  azurite:\n    image: mcr.microsoft.com/azure-storage/azurite\n',
            );
            const incompatibleAzurite = await validateLocalDebugArtifacts(workspace, plan);
            assert.equal(incompatibleAzurite.valid, false);
            assert(incompatibleAzurite.issues.some(issue => issue.code === 'azuriteApiVersionCheckEnabled'));

            tasks.tasks = tasks.tasks.filter((task: { label: string }) => task.label !== 'attendance-web: install');
            await fs.writeFile(path.join(vscodeDirectory, 'tasks.json'), JSON.stringify(tasks));
            const missingWebInstall = await validateLocalDebugArtifacts(workspace, plan);
            assert.equal(missingWebInstall.valid, false);
            assert(missingWebInstall.issues.some(issue => issue.code === 'missingServiceInstallTask'));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('confirms inferred requirements with scenario answers', async () => {
        const content = await fs.readFile(path.join(fixtureRoot, 'attendance', 'requirements.json'), 'utf8');
        const inferred = content.replaceAll('"status": "confirmed"', '"status": "inferred"');
        const confirmed = confirmRequirementsArtifact(inferred, { auth: 'No auth' });
        const result = validateRequirementsArtifact(confirmed, { requireConfirmed: true });
        assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
        assert.match(confirmed, /"executionMode": "guided"/);
    });

    test('rejects a plan without a component library', async () => {
        const content = await fs.readFile(path.join(fixtureRoot, 'attendance', 'project-plan.md'), 'utf8');
        const result = validateProjectPlanArtifact(content.replace(/^\*\*Component Library\*\*:.+$/m, ''));
        assert.equal(result.valid, false);
        assert(result.issues.some(issue => issue.code === 'missingComponentLibrary'));
    });

    test('accepts an API-only plan without a design system', async () => {
        const content = await fs.readFile(path.join(fixtureRoot, 'attendance', 'project-plan.md'), 'utf8');
        const apiPlan = content
            .replace('**App Type**: SPA + API', '**App Type**: API only')
            .replace(/\n## 3\. Attendance Compliance Web App — Web App[\s\S]*?(?=\n## 4\.)/, '')
            .replace(/\n## 6\. Design System & UI[\s\S]*?(?=\n## 7\.)/, '')
            .replace(/^## ([4-9])\./gm, (_match, section: string) => {
                const sectionNumber = Number(section);
                return `## ${sectionNumber >= 7 ? sectionNumber - 2 : sectionNumber - 1}.`;
            });
        const result = validateProjectPlanArtifact(apiPlan);
        assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    });

    test('rejects the captured API-only plan numbering failure', async () => {
        const content = await fs.readFile(path.join(fixtureRoot, 'attendance', 'project-plan.md'), 'utf8');
        const invalidApiPlan = content
            .replace('**App Type**: SPA + API', '**App Type**: API only')
            .replace(/\n## 3\. Attendance Compliance Web App — Web App[\s\S]*?(?=\n## 4\.)/, '');
        const result = validateProjectPlanArtifact(invalidApiPlan);
        assert.equal(result.valid, false);
        assert(result.issues.some(issue => issue.code === 'nonSequentialHeading'));
        assert(result.issues.some(issue => issue.code === 'unexpectedDesignSystem'));
    });

    test('accepts ASCII project-tree connectors without swallowing later sections', async () => {
        const content = await fs.readFile(path.join(fixtureRoot, 'attendance', 'project-plan.md'), 'utf8');
        const asciiTree = content
            .replaceAll('├──', '|--')
            .replaceAll('└──', '`--')
            .replaceAll('│   ', '|   ');
        const result = validateProjectPlanArtifact(asciiTree);
        assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    });

    test('loads the stratified twenty-scenario corpus', async () => {
        const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
        assert.equal(scenarios.length, 20);
        for (const archetype of ['api', 'crud', 'worker', 'multiservice', 'static-api']) {
            assert(scenarios.some(scenario => scenario.tags.archetype === archetype), `Missing ${archetype} scenario.`);
        }
        for (const profile of ['minimal', 'standard', 'advanced']) {
            assert(scenarios.some(scenario => scenario.validation.profile === profile), `Missing ${profile} validation profile.`);
        }
    });

    test('keeps scaffold runtime guidance on validated contracts', async () => {
        const resources = path.resolve(__dirname, '..', '..', 'resources', 'agents');
        const [dotnet, python, testing, typescript, pythonDebug, functionsDebug] = await Promise.all([
            fs.readFile(path.join(resources, 'shared-references', 'runtimes', 'dotnet.md'), 'utf8'),
            fs.readFile(path.join(resources, 'shared-references', 'runtimes', 'python.md'), 'utf8'),
            fs.readFile(path.join(resources, 'azure-project-scaffold', 'references', 'testing.md'), 'utf8'),
            fs.readFile(path.join(resources, 'shared-references', 'runtimes', 'typescript.md'), 'utf8'),
            fs.readFile(path.join(resources, 'azure-debug-generate', 'references', 'runtimes', 'python.md'), 'utf8'),
            fs.readFile(path.join(resources, 'azure-debug-generate', 'references', 'project-types', 'functions.md'), 'utf8'),
        ]);

        assert.doesNotMatch(dotnet, /Package(?:Reference|Version) Include="FluentValidation\.TestHelper"/);
        assert.doesNotMatch(dotnet, /Package(?:Reference|Version) Include="Microsoft\.Azure\.Functions\.Worker\.OpenTelemetry"/);
        assert.match(dotnet, /Microsoft\.Azure\.Functions\.Worker" Version="2\.52\.0"/);
        assert.match(dotnet, /System\.Security\.Cryptography\.Xml" Version="10\.0\.10"/);
        assert.match(python, /requires-python = ">=3\.12,<3\.13"/);
        assert.match(python, /except \(ServiceRequestError, ServiceResponseError\)/);
        assert.match(testing, /body: \{ string: JSON\.stringify\(body\) \}/);
        assert.match(testing, /import \{ HttpRequest, InvocationContext \}/);
        assert.match(typescript, /argsIgnorePattern: '\^_'/);
        assert.match(dotnet, /using Microsoft\.Azure\.Functions\.Worker;/);
        assert.match(dotnet, /\.ConfigureFunctionsApplicationInsights\(\);/);
        assert.match(dotnet, /JsonSerializer\.SerializeAsync\(/);
        assert.match(pythonDebug, /languageWorkers__python__defaultExecutablePath/);
        assert.match(pythonDebug, /-m debugpy --listen 9091/);
        assert.match(functionsDebug, /\| python\s+\| ✅ Implemented \|/);
    });

    test('reports Wilson intervals and normalized failure categories', () => {
        const interval = wilsonInterval(18, 20);
        assert(interval);
        assert(Math.abs(interval.lower - 0.699) < 0.001);
        assert(Math.abs(interval.upper - 0.972) < 0.001);
        assert.equal(wilsonInterval(0, 0), null);
        assert.equal(classifyFailure({
            runId: 'run-1',
            scenarioId: 'scenario',
            attempt: 1,
            outcome: 'failed',
            failedStage: 'build',
            failureCode: 'sandboxCreateFailed',
            durationMs: 1,
        }), 'infrastructure_failure');
        assert.equal(classifyFailure({
            runId: 'run-2',
            scenarioId: 'scenario',
            attempt: 1,
            outcome: 'failed',
            failedStage: 'plan',
            failureCode: 'artifactInvalid',
            durationMs: 1,
        }), 'product_failure');
    });

    test('reports repaired successes separately from first-pass outcomes', () => {
        const report = createReport([{
            candidateCommit: 'candidate',
            agentAssetsHash: 'assets',
            through: 'scaffold',
            results: [
                {
                    runId: 'first-pass',
                    scenarioId: 'api-ts-functions-minimal',
                    attempt: 1,
                    outcome: 'autonomous_success',
                    durationMs: 1,
                    agentRetries: 0,
                },
                {
                    runId: 'repaired',
                    scenarioId: 'api-ts-functions-minimal',
                    attempt: 2,
                    outcome: 'autonomous_success',
                    durationMs: 1,
                    agentRetries: 1,
                },
            ],
        }], [{
            schemaVersion: '1',
            id: 'api-ts-functions-minimal',
            prompt: 'Build an API.',
            baselinePrompt: 'Build a complete standalone API project with source code, configuration, tests, local debugging support, and deployment-ready infrastructure.',
            tags: { backend: 'typescript-functions' },
            validation: {
                profile: 'minimal',
                build: true,
                test: true,
                lint: 'required',
                timeoutMinutes: 5,
            },
        }], []);

        assert.equal(report.firstPassOutcome.successes, 1);
        assert.equal(report.autonomousOutcome.successes, 2);
        assert.equal(report.recoveredSuccesses, 1);
    });

    test('reports browser interaction success separately from browser quality', () => {
        const report = createReport([{
            candidateCommit: 'candidate',
            agentAssetsHash: 'assets',
            through: 'local',
            results: [{
                runId: 'interaction-passed-accessibility-failed',
                scenarioId: 'crud-react-functions-postgres',
                attempt: 1,
                outcome: 'failed',
                failedStage: 'local-runtime',
                failureCode: 'localBrowserFailed',
                durationMs: 1,
                stages: [{
                    name: 'local-runtime',
                    localRuntimeValidation: {
                        outcome: 'failed',
                        browserChecks: [{
                            success: false,
                            actionsCompleted: 6,
                            actionsExpected: 6,
                            assertionsCompleted: 2,
                            assertionsExpected: 2,
                            accessibilityScanned: true,
                            seriousAccessibilityViolations: ['color-contrast:serious'],
                        }],
                    },
                }],
            }],
        }], [{
            schemaVersion: '1',
            id: 'crud-react-functions-postgres',
            prompt: 'Build a ticket application.',
            baselinePrompt: 'Build a complete standalone ticket application with frontend, backend, persistence, tests, local debugging support, and deployment-ready infrastructure.',
            tags: { frontend: 'react' },
            validation: {
                profile: 'standard',
                build: true,
                test: true,
                lint: 'if-present',
                timeoutMinutes: 10,
            },
        }], []);

        assert.equal(report.browserAcceptance.successes, 0);
        assert.equal(report.browserAcceptance.interaction.attempts, 1);
        assert.equal(report.browserAcceptance.interaction.successes, 1);
        assert.equal(report.browserAcceptance.accessibilityScans, 1);
        assert.equal(report.browserAcceptance.accessibilityScanFailures, 0);
        assert.equal(report.browserAcceptance.seriousAccessibilityViolations, 1);
    });

    test('reports persistence and worker events as distinct journey dimensions', () => {
        const report = createReport([{
            candidateCommit: 'candidate',
            agentAssetsHash: 'assets',
            through: 'local',
            results: [{
                runId: 'runtime-oracles',
                scenarioId: 'api-ts-functions-minimal',
                attempt: 1,
                outcome: 'failed',
                failedStage: 'local-runtime',
                failureCode: 'localStorageEventFailed',
                durationMs: 1,
                stages: [{
                    name: 'local-runtime',
                    localRuntimeValidation: {
                        outcome: 'failed',
                        persistenceChecks: [{ success: true }, { success: false }],
                        workerEvents: [{ success: false }],
                    },
                }],
            }],
        }], [{
            schemaVersion: '1',
            id: 'api-ts-functions-minimal',
            prompt: 'Build an API.',
            baselinePrompt: 'Build a complete standalone API project with source, tests, local debugging support, and deployment-ready infrastructure configuration.',
            tags: { backend: 'typescript-functions' },
            validation: {
                profile: 'minimal',
                build: true,
                test: true,
                lint: 'required',
                timeoutMinutes: 5,
            },
        }], []);

        const persistence = report.userJourneyDimensions.find(value => value.dimension === 'Durable application persistence');
        const events = report.userJourneyDimensions.find(value => value.dimension === 'Worker storage events');
        assert.deepEqual(
            { attempts: persistence?.attempts, successes: persistence?.successes },
            { attempts: 2, successes: 1 },
        );
        assert.deepEqual(
            { attempts: events?.attempts, successes: events?.successes },
            { attempts: 1, successes: 0 },
        );
        assert.equal(classifyFailure({
            runId: 'worker-event',
            scenarioId: 'scenario',
            attempt: 1,
            outcome: 'failed',
            failedStage: 'local-runtime',
            failureCode: 'localStorageEventFailed',
            durationMs: 1,
        }), 'product_failure');
    });

    test('regrades archived build outcomes with provenance', () => {
        const source = {
            runId: 'run-1',
            scenarioId: 'api-csharp-functions-sql',
            attempt: 1,
            outcome: 'failed' as const,
            failedStage: 'build',
            failureCode: 'sandboxSetupFailed',
            failureCategory: 'infrastructure_failure' as const,
            error: 'SDK missing.',
            durationMs: 100,
            stages: [
                { name: 'plan', validation: { valid: true, issues: [] } },
                { name: 'build', buildValidation: { outcome: 'failed' as const, commands: [] } },
            ],
        };
        const result = applyBuildRevalidation(
            source,
            { outcome: 'passed', commands: [] },
            50,
            { sourceWorkspace: '/source/workspace', startedAt: '2026-08-06T00:00:00.000Z' },
        );

        assert.equal(result.outcome, 'autonomous_success');
        assert.equal(result.durationMs, 150);
        assert.equal(result.failedStage, undefined);
        assert.equal(result.failureCategory, undefined);
        assert.deepEqual(result.stages.at(-1), {
            name: 'build',
            buildValidation: { outcome: 'passed', commands: [] },
        });

        const laterFailure = applyBuildRevalidation(
            {
                ...source,
                failedStage: 'local-runtime',
                failureCode: 'localProbeFailed',
            },
            { outcome: 'passed', commands: [] },
            50,
            { sourceWorkspace: '/source/workspace', startedAt: '2026-08-06T00:00:00.000Z' },
        );
        assert.equal(laterFailure.outcome, 'failed');
        assert.equal(laterFailure.failedStage, 'local-runtime');
        const failedUnrelatedRevalidation = applyBuildRevalidation(
            {
                ...source,
                failedStage: 'local-runtime',
                failureCode: 'localProbeFailed',
            },
            { outcome: 'failed', commands: [], failureCode: 'sandboxCommandFailed' },
            50,
            { sourceWorkspace: '/source/workspace', startedAt: '2026-08-06T00:00:00.000Z' },
        );
        assert.equal(failedUnrelatedRevalidation.outcome, 'failed');
        assert.equal(failedUnrelatedRevalidation.failedStage, 'local-runtime');
        assert.equal(failedUnrelatedRevalidation.failureCode, 'localProbeFailed');
    });

    test('regrades archived local-runtime outcomes with provenance', () => {
        const source = {
            runId: 'run-1',
            scenarioId: 'api-ts-functions-minimal',
            attempt: 1,
            outcome: 'failed' as const,
            failedStage: 'local-runtime',
            failureCode: 'localToolchainUnavailable',
            failureCategory: 'infrastructure_failure' as const,
            error: 'Functions Core Tools missing.',
            durationMs: 100,
            stages: [
                { name: 'build', buildValidation: { outcome: 'passed' as const, commands: [] } },
                { name: 'local-runtime', localRuntimeValidation: { outcome: 'failed' as const, commands: [], probes: [] } },
            ],
        };
        const result = applyLocalRevalidation(
            source,
            { outcome: 'passed', commands: [], probes: [] },
            { valid: true, issues: [] },
            50,
            { sourceWorkspace: '/source/workspace', startedAt: '2026-08-06T00:00:00.000Z' },
        );

        assert.equal(result.outcome, 'autonomous_success');
        assert.equal(result.durationMs, 150);
        assert.equal(result.failedStage, undefined);
        assert.equal(result.failureCategory, undefined);
        assert.deepEqual(result.stages.slice(-2), [
            { name: 'local-artifacts', validation: { valid: true, issues: [] } },
            { name: 'local-runtime', localRuntimeValidation: { outcome: 'passed', commands: [], probes: [] } },
        ]);
    });

    test('preserves repair budgets and validates resume provenance', async () => {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-resume-provenance-'));
        const resultPath = path.join(tempDirectory, 'run-result.json');
        const sourceResult = {
            schemaVersion: '1',
            evaluationArm: 'rails',
            runId: 'source-run',
            scenarioId: 'api-node-functions-cosmos',
            attempt: 2,
            candidateCommit: 'abc123',
            agentAssetsHash: 'assets123',
            requestedModel: 'test-model',
            observedModels: ['test-model'],
            outcome: 'failed',
            failedStage: 'build',
            failureCode: 'projectCommandFailed',
            failureCategory: 'product_failure',
            durationMs: 1000,
            agentRetries: 2,
            stages: [
                { name: 'build' },
                { name: 'repair' },
                { name: 'build' },
                { name: 'repair' },
                { name: 'build' },
            ],
        };
        await fs.writeFile(resultPath, JSON.stringify(sourceResult));
        try {
            const loaded = await readSourceResult(resultPath, sourceResult.scenarioId);
            assert.equal(loaded.runId, sourceResult.runId);
            assert.equal(loaded.agentRetries, 2);
            assert.equal(countRepairStages(loaded.stages, 'repair'), 2);
            await assert.rejects(
                readSourceResult(resultPath, 'different-scenario'),
                /Invalid or mismatched resume provenance/,
            );
            await fs.writeFile(resultPath, JSON.stringify({ ...sourceResult, agentRetries: 1 }));
            await assert.rejects(
                readSourceResult(resultPath, sourceResult.scenarioId),
                /Invalid resume retry provenance/,
            );
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });

    test('applies the production approval transition for headless scaffolding', async () => {
        const content = await fs.readFile(path.join(fixtureRoot, 'attendance', 'project-plan.md'), 'utf8');
        const approved = replaceProjectPlanStatus(content, ProjectPlanStatus.approved);
        assert(approved);
        const autopilot = setProjectPlanExecutionMode(approved, 'auto');
        assert.match(autopilot, /^\*\*Status\*\*: Approved$/m);
        assert.match(autopilot, /^\*\*Execution Mode\*\*: auto$/m);
    });

    test('validates the scaffold integration hand-off contract', () => {
        const content = [
            '# Integration Plan',
            '## Backend',
            'Project: services/api. Build command: npm run build. Health endpoint: /api/health.',
            '## Frontend',
            'Project: services/web. API seam: src/api/index.ts. Build command: npm run build.',
            '## API Routes',
            'GET /api/health and POST /api/items.',
            '## Database',
            'PostgreSQL migrations live under migrations/. NO seed data.',
            '## Services',
            'API and web are Essential.',
        ].join('\n\n');
        const result = validateIntegrationPlanArtifact(content, { hasFrontend: true });
        assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    });

    test('rejects frontend mock imports after integration', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-integration-output-test-'));
        try {
            const apiDirectory = path.join(workspace, 'services', 'web', 'src', 'api');
            await fs.mkdir(apiDirectory, { recursive: true });
            await fs.writeFile(path.join(apiDirectory, 'index.ts'), [
                "import { mockClient } from './mockClient';",
                'export const api = mockClient;',
            ].join('\n'));
            await fs.writeFile(path.join(apiDirectory, 'mockClient.ts'), 'export const mockClient = {};\n');

            const failed = await validateIntegrationOutput(workspace, { hasFrontend: true });
            assert.equal(failed.valid, false);
            assert(failed.issues.some(issue => issue.code === 'frontendMockStillImported'));

            await fs.writeFile(path.join(apiDirectory, 'index.ts'), "import './mock';\n");
            const exactMock = await validateIntegrationOutput(workspace, { hasFrontend: true });
            assert.equal(exactMock.valid, false);
            assert(exactMock.issues.some(issue => issue.code === 'frontendMockStillImported'));

            await fs.writeFile(path.join(apiDirectory, 'index.ts'), [
                "import { liveClient } from './client';",
                'export const api = liveClient;',
            ].join('\n'));
            const passed = await validateIntegrationOutput(workspace, { hasFrontend: true });
            assert.equal(passed.valid, true, JSON.stringify(passed.issues, null, 2));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('accepts arm-neutral frontend integration layouts', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-generic-integration-output-test-'));
        try {
            const sourceDirectory = path.join(workspace, 'web', 'src');
            await fs.mkdir(sourceDirectory, { recursive: true });
            await fs.writeFile(
                path.join(sourceDirectory, 'client.ts'),
                "export const loadTickets = () => fetch('/api/tickets');\n",
            );
            const result = await validateIntegrationOutput(workspace, { hasFrontend: true });
            assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('requires integrated mock identities to be seeded', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-integration-auth-test-'));
        try {
            const apiDirectory = path.join(workspace, 'services', 'web', 'src', 'api');
            const migrationDirectory = path.join(workspace, 'services', 'api', 'migrations');
            await fs.mkdir(apiDirectory, { recursive: true });
            await fs.mkdir(migrationDirectory, { recursive: true });
            await fs.writeFile(path.join(apiDirectory, 'index.ts'), "export { liveClient as api } from './client';\n");
            await fs.writeFile(path.join(apiDirectory, 'client.ts'), [
                "const mockUserId = '00000000-0000-4000-8000-000000000001';",
                "headers.set('X-Mock-User-Id', mockUserId);",
                'export const liveClient = {};',
            ].join('\n'));
            await fs.writeFile(path.join(migrationDirectory, 'initial.cjs'), 'exports.up = () => {};\n');

            const failed = await validateIntegrationOutput(workspace, { hasFrontend: true });
            assert(failed.issues.some(issue => issue.code === 'mockAuthIdentityUnseeded'));

            await fs.writeFile(
                path.join(migrationDirectory, 'initial.cjs'),
                "exports.up = pgm => pgm.sql(\"INSERT INTO users (id) VALUES ('00000000-0000-4000-8000-000000000001')\");\n",
            );
            const passed = await validateIntegrationOutput(workspace, { hasFrontend: true });
            assert.equal(passed.valid, true, JSON.stringify(passed.issues, null, 2));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('runs integration before post-integration project validation', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-integration-stage-test-'));
        try {
            const azureDirectory = path.join(workspace, '.azure');
            const apiDirectory = path.join(workspace, 'services', 'web', 'src', 'api');
            await fs.mkdir(azureDirectory, { recursive: true });
            await fs.mkdir(apiDirectory, { recursive: true });
            const plan = await fs.readFile(path.join(fixtureRoot, 'attendance', 'project-plan.md'), 'utf8');
            await fs.writeFile(path.join(azureDirectory, 'project-plan.md'), plan);
            await fs.writeFile(path.join(apiDirectory, 'index.ts'), [
                "import { liveClient } from './client';",
                'export const api = liveClient;',
            ].join('\n'));

            const executor = new CopilotSdkAgentExecutor(path.resolve(__dirname, '..', '..'));
            executor.run = async request => {
                assert.equal(request.agentName, 'azure-project-integrate');
                assert.match(
                    await fs.readFile(path.join(azureDirectory, 'project-plan.md'), 'utf8'),
                    /^\*\*Status\*\*: Integrating$/m,
                );
                const currentPlan = await fs.readFile(path.join(azureDirectory, 'project-plan.md'), 'utf8');
                const integratedPlan = replaceProjectPlanStatus(currentPlan, ProjectPlanStatus.integrated);
                assert(integratedPlan);
                await fs.writeFile(path.join(azureDirectory, 'project-plan.md'), integratedPlan);
                await request.tools?.find(tool => tool.name === 'start_local_development')?.handler({});
                return {
                    outcome: 'completed',
                    startedAt: '2026-08-06T00:00:00.000Z',
                    completedAt: '2026-08-06T00:00:01.000Z',
                    durationMs: 1000,
                    usage: {
                        apiCalls: 1,
                        inputTokens: 1,
                        outputTokens: 1,
                        reasoningTokens: 0,
                        cacheReadTokens: 0,
                        totalNanoAiu: 0,
                        models: [],
                    },
                    toolCalls: [],
                    errors: [],
                };
            };
            const projectValidator = new SandboxProjectValidator(path.resolve(__dirname, '..', '..'));
            projectValidator.validate = async () => ({ outcome: 'passed', commands: [] });
            const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const scenario = scenarios.find(value => value.id === 'crud-react-functions-postgres');
            assert(scenario);
            const stages: EvaluationStageResult[] = [];

            await runIntegrationStages({
                workspace,
                scenario,
                executor,
                projectValidator,
                stages,
                hasFrontend: true,
            });

            assert.deepEqual(stages.map(stage => stage.name), ['integration', 'integration-build']);
            assert.equal(stages[0].gateCalled, true);
            assert.equal(stages[0].validation?.valid, true, JSON.stringify(stages[0].validation?.issues, null, 2));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('requires complete frontend preview artifacts', async () => {
        const previewDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-preview-test-'));
        try {
            await fs.writeFile(path.join(previewDirectory, 'manifest.json'), JSON.stringify({
                previewStatus: 'ready',
                pages: [
                    { slug: 'dashboard', title: 'Dashboard', route: '/', status: 'pending' },
                ],
            }));
            await fs.writeFile(path.join(previewDirectory, 'theme.css'), ':root { color: black; }\n');
            await fs.writeFile(path.join(previewDirectory, 'dashboard.html'), '<!DOCTYPE html><title>Dashboard</title>\n');
            const valid = await validatePreviewArtifacts(previewDirectory);
            assert.equal(valid.valid, true, JSON.stringify(valid.issues, null, 2));

            await fs.writeFile(path.join(previewDirectory, 'manifest.json'), JSON.stringify({
                previewStatus: 'generating',
                pages: [{ slug: 'missing-page' }],
            }));
            const invalid = await validatePreviewArtifacts(previewDirectory);
            assert.equal(invalid.valid, false);
            assert(invalid.issues.some(issue => issue.code === 'previewNotReady'));
            assert(invalid.issues.some(issue => issue.code === 'missingPreviewHtml'));
        } finally {
            await fs.rm(previewDirectory, { recursive: true, force: true });
        }
    });

    test('requires scenario frontend intent and plan-view ordering', () => {
        const valid = validatePlanEvaluationContract(true, true, {
            called: true,
            previewManifestPresentAtCall: true,
            previewHtmlFilesAtCall: [],
        });
        assert.equal(valid.valid, true, JSON.stringify(valid.issues, null, 2));

        const invalid = validatePlanEvaluationContract(true, false, {
            called: true,
            previewManifestPresentAtCall: false,
            previewHtmlFilesAtCall: ['dashboard.html'],
        });
        assert.equal(invalid.valid, false);
        assert(invalid.issues.some(issue => issue.code === 'frontendIntentMismatch'));
        assert(invalid.issues.some(issue => issue.code === 'previewManifestMissingAtGate'));
        assert(invalid.issues.some(issue => issue.code === 'previewRenderedBeforeGate'));
    });

    test('discovers sandbox validation commands by ecosystem', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-validator-test-'));
        try {
            await fs.mkdir(path.join(workspace, 'node'));
            await fs.writeFile(path.join(workspace, 'node', 'package.json'), JSON.stringify({
                scripts: {
                    build: 'tsc',
                    test: 'vitest run',
                    lint: 'eslint .',
                },
            }));
            await fs.writeFile(path.join(workspace, 'node', 'package-lock.json'), '{}');
            await fs.mkdir(path.join(workspace, 'python'));
            await fs.writeFile(path.join(workspace, 'python', 'requirements.txt'), 'pytest\n');
            await fs.writeFile(path.join(workspace, 'python', 'requirements-dev.txt'), 'ruff\n');
            await fs.writeFile(path.join(workspace, 'python', 'pyproject.toml'), [
                '[project]',
                'name = "evaluation-fixture"',
                'version = "1.0.0"',
                '[project.optional-dependencies]',
                'test = ["pytest"]',
                'dev = ["ruff"]',
            ].join('\n'));
            await fs.mkdir(path.join(workspace, 'python-config-only'));
            await fs.writeFile(path.join(workspace, 'python-config-only', 'pyproject.toml'), [
                '[tool.ruff]',
                'line-length = 100',
            ].join('\n'));
            await fs.mkdir(path.join(workspace, 'dotnet'));
            await fs.writeFile(path.join(workspace, 'dotnet', 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');

            const [scenario] = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const targets = await discoverProjectValidationTargets(workspace, scenario);
            assert.deepEqual(
                targets.map(target => target.ecosystem).sort(),
                ['dotnet', 'node', 'python', 'python'],
            );
            const node = targets.find(target => target.ecosystem === 'node');
            assert(node?.commands.includes('npm ci --ignore-scripts'));
            assert(node?.commands.includes('npm run build'));
            assert(node?.commands.includes('npm test'));
            assert(node?.commands.includes('npm run lint'));
            const python = targets.find(target => target.ecosystem === 'python');
            assert.deepEqual(python?.commands.slice(0, 4), [
                'python -m venv .cor-eval-venv',
                '.cor-eval-venv/bin/pip install -r \'requirements.txt\'',
                '.cor-eval-venv/bin/pip install -r \'requirements-dev.txt\'',
                '.cor-eval-venv/bin/pip install \'.[dev,test]\'',
            ]);
            assert(python?.commands.includes('.cor-eval-venv/bin/python -m ruff check .'));
            const configOnlyPython = targets.find(target =>
                target.relativeDirectory === path.join('python-config-only'));
            assert(configOnlyPython);
            assert(!configOnlyPython.commands.some(command => command.includes('pip install \'.\'')));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('continues past failed tests but not failed builds', async () => {
        const command = (value: string, success: boolean) => ({
            ecosystem: 'node' as const,
            relativeDirectory: '.',
            command: value,
            success,
            failureKind: success ? undefined : 'commandExit' as const,
            durationMs: 1,
            stdout: '',
            stderr: '',
        });
        const testFailure = {
            outcome: 'failed' as const,
            failureCode: 'sandboxCommandFailed' as const,
            error: '.: "npm test" failed.',
            commands: [
                command('npm run build', true),
                command('npm test', false),
            ],
        };
        const buildFailure = {
            ...testFailure,
            error: '.: "npm run build" failed.',
            commands: [command('npm run build', false)],
        };
        assert.equal(classifySandboxValidationCommand(testFailure.commands[1]), 'test');
        assert.equal(classifySandboxValidationCommand({
            ecosystem: 'node',
            command: 'node -e "console.error(\'Missing required npm script: test\'); process.exit(1)"',
        }), 'test');
        assert.equal(canContinueAfterProjectValidationFailure(testFailure), true);
        assert.equal(canContinueAfterProjectValidationFailure(buildFailure), false);
        assert.equal(canContinueAfterProjectValidationFailure({
            ...testFailure,
            commands: [{
                ...testFailure.commands[1],
                failureKind: 'runnerError' as const,
            }],
        }), false);

        const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
        const scenario = scenarios.find(value => value.id === 'crud-react-functions-postgres');
        assert(scenario);
        const projectValidator = new SandboxProjectValidator(path.resolve(__dirname, '..', '..'));
        projectValidator.validate = async () => testFailure;
        const stages: EvaluationStageResult[] = [];
        const failure = await runProjectValidationStages({
            workspace: path.resolve(__dirname, '..', '..'),
            scenario,
            executor: new CopilotSdkAgentExecutor(path.resolve(__dirname, '..', '..')),
            projectValidator,
            stages,
            repairBudget: createAgentRepairBudget(0),
            continueAfterQualityFailure: true,
        });
        assert.equal(failure?.code, 'sandboxCommandFailed');
        assert.deepEqual(stages.map(stage => stage.name), ['build']);
    });

    test('validates workspace child scripts missing from the npm root', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-workspace-test-'));
        try {
            await fs.mkdir(path.join(workspace, 'packages', 'api'), { recursive: true });
            await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
                workspaces: ['packages/*'],
                scripts: { test: 'npm test --workspaces' },
            }));
            await fs.writeFile(path.join(workspace, 'packages', 'api', 'package.json'), JSON.stringify({
                scripts: {
                    build: 'tsc',
                    test: 'vitest run',
                    lint: 'eslint .',
                },
            }));
            const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const scenario = scenarios.find(value => value.id === 'api-ts-functions-minimal');
            assert(scenario);

            const targets = await discoverProjectValidationTargets(workspace, scenario);
            const root = targets.find(target => target.relativeDirectory === '.');
            const child = targets.find(target => target.relativeDirectory === path.join('packages', 'api'));
            assert.deepEqual(root?.commands, ['npm install --ignore-scripts', 'npm test']);
            assert.deepEqual(child?.commands, ['npm run build', 'npm run lint']);
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('validates later service builds only after a confirmed command failure', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-workspace-continuation-test-'));
        const executed: { directory: string; command: string }[] = [];
        const sandboxId = '8fb67372-7cd4-480e-8627-fc09274c9ac8';
        let remoteExitCode = 1;
        const aca: AcaCommandRunner = {
            run: async args => {
                if (args[1] === 'apply') {
                    return { stdout: JSON.stringify({ id: sandboxId }), stderr: '' };
                }
                const workingDirectoryIndex = args.indexOf('--working-directory');
                if (
                    args[1] === 'exec'
                    && workingDirectoryIndex >= 0
                    && args[workingDirectoryIndex + 1].startsWith('/workspace')
                ) {
                    const value = {
                        directory: args[workingDirectoryIndex + 1],
                        command: args[args.indexOf('-c') + 1],
                    };
                    executed.push(value);
                    if (value.directory === '/workspace' && value.command.includes('( npm test )')) {
                        const marker = value.command.match(/(__COR_EVAL_REMOTE_EXIT_[^=]+__=)/u)?.[1];
                        assert(marker);
                        const error = new Error('No test files found') as Error & { stderr: string };
                        error.stderr = `No test files found\n${marker}${remoteExitCode}\n`;
                        throw error;
                    }
                }
                return { stdout: '', stderr: '' };
            },
        };
        try {
            await fs.mkdir(path.join(workspace, 'packages', 'api'), { recursive: true });
            await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
                workspaces: ['packages/*'],
                scripts: { test: 'npm test --workspaces' },
            }));
            await fs.writeFile(path.join(workspace, 'packages', 'api', 'package.json'), JSON.stringify({
                scripts: {
                    build: 'tsc',
                    test: 'vitest run',
                    lint: 'eslint .',
                },
            }));
            const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const scenario = scenarios.find(value => value.id === 'api-ts-functions-minimal');
            assert(scenario);

            const result = await new SandboxProjectValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, scenario);
            assert.equal(result.failureCode, 'sandboxCommandFailed');
            assert.equal(canContinueAfterProjectValidationFailure(result), true);
            assert(executed.some(value =>
                value.directory === '/workspace/packages/api'
                && value.command.includes('( npm run build )')));

            remoteExitCode = 0;
            executed.length = 0;
            const transportFailure = await new SandboxProjectValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, scenario);
            assert.equal(canContinueAfterProjectValidationFailure(transportFailure), false);
            assert.equal(
                executed.some(value =>
                    value.directory === '/workspace/packages/api'
                    && value.command.includes('( npm run build )')),
                false,
            );
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('reads sandbox ids from ACA apply output', () => {
        const id = '8fb67372-7cd4-480e-8627-fc09274c9ac8';
        assert.equal(readSandboxId(`Created sandbox:\n${JSON.stringify({ id })}\n`), id);
        assert.equal(readSandboxId(`Created sandbox ${id}`), id);
        assert.equal(readSandboxId(id), id);
        assert.deepEqual(readSandboxIds(`Sandboxes:\n${JSON.stringify([{ id }])}`), [id]);
    });

    test('adds a unique run label to sandbox manifests', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-manifest-test-'));
        const sourcePath = path.join(directory, 'source.yaml');
        const destinationPath = path.join(directory, 'generated.yaml');
        try {
            await fs.writeFile(sourcePath, 'disk: node-22\nlabels:\n  role: validator\n');
            await createSandboxManifest(sourcePath, destinationPath, 'run-123');
            const generated = await fs.readFile(destinationPath, 'utf8');
            assert.match(generated, /^ {2}run-id: run-123$/m);
            assert.match(generated, /^ {2}role: validator$/m);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('uses the reusable local-development disk and runtime dependency allow-list', async () => {
        const manifestNames = ['sandbox.yaml', 'sandbox-python.yaml', 'sandbox-dotnet.yaml'];
        const manifests = await Promise.all(manifestNames.map(name =>
            fs.readFile(path.resolve(__dirname, '..', '..', 'evals', name), 'utf8')));
        for (const manifest of manifests) {
            assert.match(manifest, /^diskId: 344c39f7-88b1-4c71-8d84-2cb26930d1cc$/m);
            assert.match(manifest, /^ {4}- pattern: mcr\.microsoft\.com$/m);
            assert.match(manifest, /^ {4}- pattern: "\*\.data\.mcr\.microsoft\.com"$/m);
            assert.match(manifest, /^ {4}- pattern: "\*\.docker\.io"$/m);
            assert.match(manifest, /^ {4}- pattern: "\*\.r2\.cloudflarestorage\.com"$/m);
        }
        assert.match(manifests[0], /^ {4}- pattern: cdn\.functions\.azure\.com$/m);
    });

    test('deletes a sandbox when apply fails after creation', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-cleanup-test-'));
        const sandboxId = '8fb67372-7cd4-480e-8627-fc09274c9ac8';
        const calls: string[][] = [];
        const aca: AcaCommandRunner = {
            run: async (args: string[]) => {
                calls.push(args);
                if (args[1] === 'apply') {
                    const error = new Error('apply timed out') as Error & { stdout: string };
                    error.stdout = `Created sandbox ${sandboxId}`;
                    throw error;
                }
                if (args[1] === 'list') {
                    return { stdout: '[]', stderr: '' };
                }
                return { stdout: '', stderr: '' };
            },
        };
        try {
            await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
                scripts: { build: 'tsc', test: 'vitest run' },
            }));
            const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const scenario = scenarios.find(value => value.id === 'api-ts-functions-minimal');
            assert(scenario);
            const result = await new SandboxProjectValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, scenario);
            assert.equal(result.failureCode, 'sandboxCreateFailed');
            assert(calls.some(args => args[1] === 'delete' && args.includes(sandboxId)));
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('strictly validates local request, persistence, and storage event contracts', async () => {
        const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
        const api = scenarios.find(value => value.id === 'api-ts-functions-minimal');
        const react = scenarios.find(value => value.id === 'crud-react-functions-postgres');
        const worker = scenarios.find(value => value.id === 'worker-ts-functions-queue');
        assert(api && react && worker);

        const request = structuredClone(api);
        Object.assign(request.acceptance?.local?.probes[0] ?? {}, {
            method: 'POST',
            headers: { 'X-Evaluation': 'safe' },
            body: { note: 'created' },
        });
        assert.doesNotThrow(() => validateScenario(request, 'request.json'));
        const badHeader = structuredClone(request);
        Object.assign(badHeader.acceptance?.local?.probes[0]?.headers ?? {}, { 'X-Bad': 'line\nbreak' });
        assert.throws(() => validateScenario(badHeader, 'bad-header.json'), /headers contain an invalid/);
        const getBody = structuredClone(request);
        Object.assign(getBody.acceptance?.local?.probes[0] ?? {}, { method: 'GET' });
        assert.throws(() => validateScenario(getBody, 'get-body.json'), /GET requests cannot declare a body/);

        const badPersistence = structuredClone(react);
        const browser = badPersistence.acceptance?.local?.probes.find(probe => probe.browser)?.browser;
        assert(browser?.persistence);
        browser.persistence.assertions = [];
        assert.throws(() => validateScenario(badPersistence, 'bad-persistence.json'), /assertions must be non-empty/);

        const badStorage = structuredClone(worker);
        assert(badStorage.acceptance?.local?.storageEvents);
        const queueEvent = badStorage.acceptance.local.storageEvents[0];
        assert.equal(queueEvent.kind, 'queue');
        if (queueEvent.kind !== 'queue') {
            throw new Error('Expected queue storage event.');
        }
        queueEvent.outputQueue = queueEvent.inputQueue;
        assert.throws(() => validateScenario(badStorage, 'bad-storage.json'), /input and output queues must differ/);

        const blobWorker = scenarios.find(scenario => scenario.id === 'worker-python-functions-blob');
        assert(blobWorker);
        const badBlobStorage = structuredClone(blobWorker);
        const blobEvent = badBlobStorage.acceptance?.local?.storageEvents?.[0];
        assert(blobEvent?.kind === 'blob');
        blobEvent.destinationContainer = blobEvent.sourceContainer;
        assert.throws(
            () => validateScenario(badBlobStorage, 'bad-blob-storage.json'),
            /source and destination containers must differ/,
        );
    });

    test('serializes HTTP requests and process lifecycle commands safely', () => {
        const body = { text: "quoted ' value; $(touch unsafe)" };
        const command = createHttpProbeCommand({
            name: 'create note',
            target: 'backend',
            method: 'POST',
            url: 'http://127.0.0.1:7071/api/notes',
            expectedStatus: 201,
            headers: {
                'Content-Type': 'application/json',
                'X-Test': "literal ' $(echo harmless)",
            },
            body,
        }, 10, 'notes API');
        assert.doesNotMatch(command, /quoted ' value/);
        assert.match(command, new RegExp(Buffer.from(JSON.stringify(body)).toString('base64')));
        assert.match(command, /--data-binary @'/);
        assert.match(command, /--header 'X-Test: literal '\\'' \$\(echo harmless\)'/);

        assert.equal(parseLaunchedProcessId('2345\n'), 2345);
        assert.throws(() => parseLaunchedProcessId('2345\nother'), /one process id/);
        assert.throws(() => createProcessGroupTerminationCommand(1), /Refusing to terminate/);
        const termination = createProcessGroupTerminationCommand(2345);
        assert.match(termination, /\/bin\/kill -TERM -- -2345/);
        assert.match(termination, /\/bin\/kill -KILL -- -2345/);
        assert.doesNotMatch(termination, /pkill|killall/);
    });

    test('creates deterministic evaluator-owned Azurite signing and queue scripts', () => {
        const headers = {
            'x-ms-date': 'Fri, 07 Aug 2026 17:52:44 GMT',
            'x-ms-version': '2023-11-03',
            'content-length': '0',
        };
        const first = createAzureStorageSharedKeyAuthorization(
            'PUT',
            '/devstoreaccount1/billing-events-in',
            { restype: 'queue' },
            headers,
        );
        const second = createAzureStorageSharedKeyAuthorization(
            'PUT',
            '/devstoreaccount1/billing-events-in',
            { restype: 'queue' },
            headers,
        );
        assert.equal(first, second);
        assert.equal(first, 'SharedKey devstoreaccount1:QX2izLD9JUE3cc3B6P/kPygQGzCykfpu/ZGipffguJ0=');
        assert.match(first, /^SharedKey devstoreaccount1:[A-Za-z0-9+/]+=*$/);
        const script = createQueueStorageEventScript({
            name: 'route billing event',
            kind: 'queue',
            inputQueue: 'billing-events-in',
            outputQueue: 'billing-events-out',
            message: { eventId: 'eval-001' },
            expectedMessageIncludes: { route: 'standard' },
        });
        assert.match(script, /127\.0\.0\.1/);
        assert.match(script, /port: 10001/);
        assert.match(script, /billing-events-in/);
        assert.match(script, /createHmac/);
        assert.doesNotMatch(script, /services\/|generated helper/);
        assert.doesNotThrow(() => new Function(script));

        const blobScript = createBlobStorageEventScript({
            name: 'archive expired document',
            kind: 'blob',
            sourceContainer: 'active-documents',
            destinationContainer: 'archived-documents',
            blobName: 'eval/expired.txt',
            content: 'durable acceptance content',
            metadata: { expiresAt: '2000-01-01T00:00:00Z' },
            sourceMustBeDeleted: true,
        });
        assert.match(blobScript, /port: 10000/);
        assert.match(blobScript, /active-documents/);
        assert.match(blobScript, /archived-documents/);
        assert.match(blobScript, /x-ms-blob-type/);
        assert.match(blobScript, /sourceDeleted/);
        assert.doesNotThrow(() => new Function(blobScript));
    });

    test('runs evaluator-owned local acceptance probes in an ACA sandbox', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-local-runtime-test-'));
        const sandboxId = '8fb67372-7cd4-480e-8627-fc09274c9ac8';
        const workspaceFolderVariable = '$' + '{workspaceFolder}';
        const languageWorkerArguments = 'languageWorkers__node__arguments';
        const calls: string[][] = [];
        const aca: AcaCommandRunner = {
            run: async (args: string[]) => {
                calls.push(args);
                if (args[1] === 'apply') {
                    return { stdout: JSON.stringify({ id: sandboxId }), stderr: '' };
                }
                if (args[1] === 'list') {
                    return { stdout: '[]', stderr: '' };
                }
                const commandIndex = args.indexOf('-c');
                const command = commandIndex >= 0 ? args[commandIndex + 1] : '';
                if (command.includes('cor-probe-')) {
                    return { stdout: '{"status":"healthy"}', stderr: '' };
                }
                if (command.includes("const { chromium }")) {
                    const error = new Error('browser assertion failed') as Error & {
                        code: number;
                        stdout: string;
                        stderr: string;
                    };
                    error.code = 1;
                    error.stdout = JSON.stringify({
                        currentUrl: 'http://127.0.0.1:7071/tickets/new',
                        bodyTextLength: 42,
                        bodyTextExcerpt: 'Could not create ticket',
                        accessibilityScanned: true,
                        seriousAccessibilityViolations: ['color-contrast:serious'],
                        consoleErrors: ['POST /api/tickets 500'],
                        actionsCompleted: 6,
                        actionsExpected: 6,
                        assertionsCompleted: 0,
                        assertionsExpected: 2,
                        viewport: { width: 1440, height: 900 },
                    });
                    error.stderr = 'Timed out waiting for created ticket.';
                    throw error;
                }
                return { stdout: command.includes('nohup') ? '1234\n' : '', stderr: '' };
            },
        };
        try {
            await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
            await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
                scripts: { start: 'func host start' },
            }));
            await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), JSON.stringify({
                configurations: [{ name: 'Notes API (debug)', preLaunchTask: 'notes-api: func host start' }],
            }));
            await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify({
                tasks: [
                    {
                        type: 'npm',
                        label: 'notes-api: npm install',
                        script: 'install',
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                    },
                    {
                        type: 'func',
                        label: 'notes-api: func host start',
                        command: 'host start',
                        dependsOn: 'notes-api: npm install',
                        isBackground: true,
                        options: {
                            cwd: workspaceFolderVariable,
                            env: { [languageWorkerArguments]: '--inspect=9229' },
                        },
                        problemMatcher: '$func-node-watch',
                        runOptions: { instanceLimit: 1, instancePolicy: 'silent' },
                    },
                ],
            }));
            const plan = [
                '# Azure Debug Plan',
                '',
                '## Debug Configurations',
                '',
                '| Generate | Debug Config Name | Service Label | Service Root | Project Type | Runtime | Version | Azure Dependencies |',
                '|---|---|---|---|---|---|---|---|',
                '| [x] | Notes API (debug) | Notes API | . | functions | node-ts | 22.x | — |',
            ].join('\n');
            const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const scenario = scenarios.find(value => value.id === 'api-ts-functions-minimal');
            assert(scenario);

            const result = await new SandboxLocalRuntimeValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, scenario, plan);
            assert.equal(result.outcome, 'passed', JSON.stringify(result, null, 2));
            assert.equal(result.probes.length, 1);
            assert(result.commands.some(command => command.command.includes('func host start')));
            assert(result.commands.some(command => command.command.includes('http://127.0.0.1:9229/json/list')));
            assert(calls.some(args => args[1] === 'delete' && args.includes(sandboxId)));

            assert(scenario.acceptance?.local);
            const [acceptanceProbe] = scenario.acceptance.local.probes;
            assert(acceptanceProbe);
            const browserScenario = {
                ...scenario,
                acceptance: {
                    local: {
                        ...scenario.acceptance.local,
                        probes: [{
                            ...acceptanceProbe,
                            browser: {
                                expectedText: 'ticket',
                                actions: [{ kind: 'click' as const, selector: 'button' }],
                                assertions: [{ kind: 'text' as const, selector: 'body', value: 'Created' }],
                            },
                        }],
                    },
                },
            };
            const browserFailure = await new SandboxLocalRuntimeValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, browserScenario, plan);
            assert.equal(browserFailure.failureCode, 'localBrowserFailed');
            assert.equal(browserFailure.browserChecks?.[0].actionsCompleted, 6);
            assert.equal(browserFailure.browserChecks?.[0].actionsExpected, 6);
            assert.equal(browserFailure.browserChecks?.[0].assertionsCompleted, 0);
            assert.equal(browserFailure.browserChecks?.[0].assertionsExpected, 2);
            assert.equal(browserFailure.browserChecks?.[0].currentUrl, 'http://127.0.0.1:7071/tickets/new');
            assert.equal(browserFailure.browserChecks?.[0].bodyTextExcerpt, 'Could not create ticket');
            assert.equal(browserFailure.browserChecks?.[0].accessibilityScanned, true);
            assert.deepEqual(browserFailure.browserChecks?.[0].seriousAccessibilityViolations, ['color-contrast:serious']);
            assert.deepEqual(browserFailure.browserChecks?.[0].consoleErrors, ['POST /api/tickets 500']);

            const missingContract = await new SandboxLocalRuntimeValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, { ...scenario, acceptance: undefined }, plan);
            assert.equal(missingContract.failureCode, 'acceptanceSpecMissing');
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('restarts only evaluator-launched application process groups before persistence assertions', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-persistence-runtime-test-'));
        const sandboxId = '8fb67372-7cd4-480e-8627-fc09274c9ac8';
        const commands: string[] = [];
        let nextPid = 2001;
        const aca: AcaCommandRunner = {
            run: async (args: string[]) => {
                if (args[1] === 'apply') {
                    return { stdout: JSON.stringify({ id: sandboxId }), stderr: '' };
                }
                if (args[1] !== 'exec') {
                    return { stdout: '', stderr: '' };
                }
                const command = args[args.length - 1];
                commands.push(command);
                if (command.includes('nohup setsid')) {
                    return { stdout: `${nextPid++}\n`, stderr: '' };
                }
                if (command.includes('.cor-browser/node_modules/playwright')) {
                    const afterRestart = command.includes('actionsExpected: 0');
                    return {
                        stdout: JSON.stringify({
                            currentUrl: 'http://127.0.0.1:5173/tickets/eval-ticket',
                            bodyTextLength: 60,
                            bodyTextExcerpt: 'Browser acceptance ticket Ticket details',
                            accessibilityScanned: true,
                            seriousAccessibilityViolations: [],
                            consoleErrors: [],
                            actionsCompleted: afterRestart ? 0 : 1,
                            actionsExpected: afterRestart ? 0 : 1,
                            assertionsCompleted: 1,
                            assertionsExpected: 1,
                        }),
                        stderr: '',
                    };
                }
                return { stdout: '', stderr: '' };
            },
        };
        try {
            await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
            await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), JSON.stringify({
                configurations: [
                    { name: 'Ticket API (debug)', preLaunchTask: 'ticket-api' },
                    { name: 'Ticket Frontend (debug)', preLaunchTask: 'ticket-frontend' },
                ],
            }));
            await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify({
                tasks: [
                    { type: 'shell', label: 'postgres', command: 'postgres', isBackground: true },
                    {
                        type: 'shell',
                        label: 'ticket-api',
                        command: 'node api.js',
                        dependsOn: 'postgres',
                        isBackground: true,
                    },
                    { type: 'shell', label: 'ticket-frontend', command: 'npm run dev', isBackground: true },
                ],
            }));
            const scenario = {
                schemaVersion: '1' as const,
                id: 'persistence-order',
                prompt: 'Build a durable ticket application.',
                baselinePrompt: 'Build a complete durable ticket application with frontend, backend, database, tests, local debugging, and deployment configuration.',
                tags: { archetype: 'crud' },
                validation: {
                    profile: 'standard' as const,
                    build: true,
                    test: true,
                    lint: 'if-present' as const,
                    timeoutMinutes: 10,
                },
                acceptance: {
                    local: {
                        compound: true,
                        startupTimeoutSeconds: 10,
                        probes: [
                            {
                                name: 'API readiness',
                                target: 'backend' as const,
                                method: 'GET' as const,
                                url: 'http://127.0.0.1:7071/api/health',
                                expectedStatus: 200,
                            },
                            {
                                name: 'ticket browser',
                                target: 'frontend' as const,
                                method: 'GET' as const,
                                url: 'http://127.0.0.1:5173/',
                                expectedStatus: 200,
                                browser: {
                                    actions: [{ kind: 'click' as const, selector: 'Create ticket' }],
                                    assertions: [{ kind: 'text' as const, selector: 'body', value: 'Browser acceptance ticket' }],
                                    persistence: {
                                        restartTargets: ['backend' as const, 'frontend' as const],
                                        reload: 'current-url' as const,
                                        assertions: [{ kind: 'text' as const, selector: 'body', value: 'Browser acceptance ticket' }],
                                    },
                                },
                            },
                        ],
                    },
                },
            };
            const plan = [
                '# Azure Debug Plan',
                '',
                '## Debug Configurations',
                '',
                '| Generate | Debug Config Name | Service Root | Project Type | Runtime |',
                '|---|---|---|---|---|',
                '| [x] | Ticket API (debug) | . | functions | node-ts |',
                '| [x] | Ticket Frontend (debug) | . | frontend-spa | node-ts |',
            ].join('\n');

            const result = await new SandboxLocalRuntimeValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, scenario, plan);
            assert.equal(result.outcome, 'passed', JSON.stringify(result, null, 2));
            assert.equal(result.persistenceChecks?.length, 1);
            assert.deepEqual(result.persistenceChecks?.[0].processIdsBefore, [2002, 2003]);
            assert.deepEqual(result.persistenceChecks?.[0].processIdsAfter, [2004, 2005]);
            assert.deepEqual(result.persistenceChecks?.[0].preservedProcessIds, [2001]);
            assert.equal(result.persistenceChecks?.[0].readinessProbes.length, 2);
            assert.equal(result.persistenceChecks?.[0].postRestartBrowser.assertionsCompleted, 1);
            assert(commands.some(command => command.includes('/bin/kill -TERM -- -2002')));
            assert(commands.some(command => command.includes('/bin/kill -TERM -- -2003')));
            assert(!commands.some(command => command.includes('/bin/kill -TERM -- -2001')));
            const stopIndex = commands.findIndex(command => command.includes('kill -TERM'));
            const restartIndex = commands.findIndex((command, index) =>
                index > stopIndex && command.includes('nohup setsid'));
            const postRestartBrowserIndex = commands.findIndex(command =>
                command.includes('.cor-browser/node_modules/playwright') && command.includes('actionsExpected: 0'));
            assert(stopIndex > commands.findIndex(command => command.includes('actionsExpected: 1')));
            assert(restartIndex > stopIndex);
            assert(postRestartBrowserIndex > restartIndex);
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('classifies evaluator-owned queue side-effect failures distinctly', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-storage-event-test-'));
        const sandboxId = '8fb67372-7cd4-480e-8627-fc09274c9ac8';
        const aca: AcaCommandRunner = {
            run: async (args: string[]) => {
                if (args[1] === 'apply') {
                    return { stdout: JSON.stringify({ id: sandboxId }), stderr: '' };
                }
                if (args[1] === 'exec') {
                    const command = args[args.length - 1];
                    if (command.includes('nohup setsid')) {
                        return { stdout: '3333\n', stderr: '' };
                    }
                    if (command.includes('billing-events-in') && command.includes('node -e')) {
                        const error = new Error('storage event failed') as Error & { stdout: string; stderr: string };
                        error.stdout = JSON.stringify({ pollAttempts: 2, error: 'No matching output message.' });
                        error.stderr = 'No matching output message.';
                        throw error;
                    }
                }
                return { stdout: '', stderr: '' };
            },
        };
        try {
            await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
            await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), JSON.stringify({
                configurations: [{ name: 'Billing Worker (debug)', preLaunchTask: 'billing-worker' }],
            }));
            await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify({
                tasks: [{
                    type: 'func',
                    label: 'billing-worker',
                    command: 'host start',
                    isBackground: true,
                }],
            }));
            const scenarios = await loadScenarios(path.resolve(__dirname, '..', '..', 'evals', 'scenarios'));
            const scenario = scenarios.find(value => value.id === 'worker-ts-functions-queue');
            assert(scenario);
            const plan = [
                '# Azure Debug Plan',
                '',
                '## Debug Configurations',
                '',
                '| Generate | Debug Config Name | Service Root | Project Type | Runtime |',
                '|---|---|---|---|---|',
                '| [x] | Billing Worker (debug) | . | worker | node-ts |',
            ].join('\n');
            const result = await new SandboxLocalRuntimeValidator(
                path.resolve(__dirname, '..', '..'),
                aca,
            ).validate(workspace, scenario, plan);
            assert.equal(result.outcome, 'failed');
            assert.equal(result.failureCode, 'localStorageEventFailed');
            assert.equal(result.workerEvents?.[0].success, false);
            assert.equal(result.workerEvents?.[0].pollAttempts, 2);
            assert.deepEqual(result.workerEvents?.[0].stimulus, {
                eventId: 'eval-billing-001',
                accountId: 'acct-eval-001',
                amount: 1250,
                currency: 'USD',
            });
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
        }
    });

    test('translates debugpy launch configurations for isolated execution', () => {
        const workspaceFolderVariable = '$' + '{workspaceFolder}';
        const task = resolveLaunchTask({
            name: 'Compliance Documents API (debug)',
            type: 'debugpy',
            request: 'launch',
            python: `${workspaceFolderVariable}/services/api/.venv/bin/python`,
            module: 'compliance_documents_api.app',
            cwd: `${workspaceFolderVariable}/services/api`,
            env: { PYTHONPATH: `${workspaceFolderVariable}/services/api/src` },
        }, 'services/api');
        assert(task && !('error' in task));
        assert.equal(
            task.command,
            `'${workspaceFolderVariable}/services/api/.venv/bin/python' -m debugpy --listen 127.0.0.1:${debugpyEvaluationPort} -m 'compliance_documents_api.app'`,
        );
        assert.equal(task.isBackground, true);
    });

    test('translates generic Node and CoreCLR launch configurations', () => {
        const workspaceFolderVariable = '$' + '{workspaceFolder}';
        const nodeTask = resolveLaunchTask({
            name: 'Web API',
            type: 'pwa-node',
            request: 'launch',
            runtimeExecutable: 'npm',
            runtimeArgs: ['run', 'dev'],
            cwd: `${workspaceFolderVariable}/services/api`,
        }, 'services/api');
        assert(nodeTask && !('error' in nodeTask));
        assert.equal(nodeTask.command, "'npm' 'run' 'dev'");

        const coreClrTask = resolveLaunchTask({
            name: 'Warehouse API',
            type: 'coreclr',
            request: 'launch',
            program: `${workspaceFolderVariable}/services/api/bin/Debug/net8.0/Warehouse.Api.dll`,
        }, 'services/api');
        assert(coreClrTask && !('error' in coreClrTask));
        assert.equal(
            coreClrTask.command,
            `'dotnet' '${workspaceFolderVariable}/services/api/bin/Debug/net8.0/Warehouse.Api.dll'`,
        );
    });

    test('validates literal CoreCLR attach targets', () => {
        const check = resolveDebuggerPrerequisite({
            type: 'coreclr',
            request: 'attach',
            processName: 'WarehouseInventory.Api',
        });

        assert(!('error' in check));
        assert.match(check.command ?? '', /pgrep -f/);
        assert.match(check.command ?? '', /WarehouseInventory\\\.Api/);

        const invalid = resolveDebuggerPrerequisite({
            type: 'coreclr',
            request: 'attach',
        });
        assert('error' in invalid);
    });

    test('requires structured VS Code breakpoint evidence', () => {
        const evidence = parseParityEvidence([
            'Extension host output',
            'COR_VSCODE_PARITY_RESULT=' + JSON.stringify({
                outcome: 'passed',
                configurationName: 'Ticket API (debug)',
                source: 'services/api/src/functions/health.ts',
                line: 7,
                column: 1,
                sessions: [{ id: 'session-1', name: 'Ticket API (debug)', type: 'node' }],
                stoppedReason: 'breakpoint',
                hitBreakpointIds: [1],
            }),
        ].join('\n'));
        assert.equal(evidence.stoppedReason, 'breakpoint');
        assert.equal(evidence.sessions[0].type, 'node');
        assert.throws(() => parseParityEvidence('COR_VSCODE_PARITY_RESULT={"outcome":"passed"}'));

        const command = createParityCommand({
            configurationName: "Ticket API's debug",
            sourceGlob: '**/health.ts',
            lineIncludes: 'app.http',
            triggerUrl: 'http://127.0.0.1:7071/api/health',
            timeoutMs: 180_000,
        });
        assert.match(command, /xvfb-run -a .*VSCode-linux-x64\/code/);
        assert.match(command, /COR_PARITY_CONFIGURATION='Ticket API'\\''s debug'/);
        assert.match(command, /--extensionTestsPath=\/home\/vscode\/cor-vscode-parity\/test\.js/);
    });

    test('excludes macOS metadata from sandbox workspace archives', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-archive-test-'));
        const archivePath = path.join(os.tmpdir(), `cor-archive-test-${process.pid}.tar.gz`);
        try {
            await fs.mkdir(path.join(workspace, 'src'));
            await fs.writeFile(path.join(workspace, 'src', 'index.ts'), 'export {};\n');
            await fs.writeFile(path.join(workspace, 'src', '._index.ts'), 'AppleDouble metadata');
            await fs.writeFile(path.join(workspace, '.DS_Store'), 'Finder metadata');

            await createWorkspaceArchive(workspace, archivePath);

            const { stdout } = await execFileAsync('tar', ['-tzf', archivePath]);
            assert.match(stdout, /src\/index\.ts/);
            assert.doesNotMatch(stdout, /(?:^|\/)\._/m);
            assert.doesNotMatch(stdout, /\.DS_Store/);
        } finally {
            await fs.rm(workspace, { recursive: true, force: true });
            await fs.rm(archivePath, { force: true });
        }
    });
});
