/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    buildDeployProgressMessage,
    buildDeployProgressSteps,
    buildDeployProgressTitle,
    deployProgressStepIds,
    parseDeployProgressContext,
    parseDeployResultStatus,
    type DeployProgressSignals,
} from '../../src/webviews/copilotOnRails/extension/utils/deployProgressSteps';
import type { LoadingStep, LoadingStepStatus } from '../../src/webviews/copilotOnRails/views/utils/viewConfigTypes';

function statuses(steps: readonly LoadingStep[]): LoadingStepStatus[] {
    return steps.map((step) => step.status);
}

function stepsFor(signals: DeployProgressSignals): LoadingStep[] {
    return buildDeployProgressSteps(signals);
}

suite('deployProgressSteps', () => {
    suite('buildDeployProgressSteps', () => {
        test('always returns the three post-approval steps in pipeline order', () => {
            assert.deepStrictEqual(
                stepsFor({}).map((step) => step.id),
                [deployProgressStepIds.scaffold, deployProgressStepIds.provision, deployProgressStepIds.verify],
            );
        });

        test('starts with scaffolding active and the rest pending', () => {
            assert.deepStrictEqual(statuses(stepsFor({})), ['active', 'pending', 'pending']);
        });

        test('keeps scaffolding active while the scaffold phase is running', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'scaffold', completedPhases: ['prereq', 'prepare'] })),
                ['active', 'pending', 'pending'],
            );
        });

        test('starts provisioning progress when the scaffold advances to the deploy phase', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: ['prereq', 'prepare', 'scaffold'] })),
                ['done', 'active', 'pending'],
            );
        });

        test('treats currentPhase deploy as scaffold evidence even if completedPhases lags', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: [] })),
                ['done', 'active', 'pending'],
            );
        });

        test('keeps provisioning active when the deploy result record appears', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'in-progress' })),
                ['done', 'active', 'pending'],
            );
        });

        test('advances to verifying once the deployment succeeds but the phase has not closed', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'succeeded' })),
                ['done', 'done', 'active'],
            );
        });

        test('marks everything done on a succeeded deployment', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ completedPhases: ['scaffold', 'deploy'], deployStatus: 'succeeded' })),
                ['done', 'done', 'done'],
            );
        });

        test('marks provisioning failed on a failed deployment', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'failed' })),
                ['done', 'failed', 'pending'],
            );
        });

        test('lets a terminal failure win over a deploy phase marked complete', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ completedPhases: ['scaffold', 'deploy'], deployStatus: 'failed' })),
                ['done', 'failed', 'pending'],
            );
        });

        test('a deploy result implies scaffolding finished even without context.json', () => {
            assert.deepStrictEqual(statuses(stepsFor({ deployStatus: 'in-progress' })), ['done', 'active', 'pending']);
        });

        test('renders labels only, with no per-step detail line', () => {
            const steps = stepsFor({ currentPhase: 'deploy', completedPhases: ['scaffold'] });
            assert.ok(steps.every((step) => Object.keys(step).sort().join(',') === 'id,label,status'));
        });
    });

    suite('buildDeployProgressTitle', () => {
        test('shows the deployment title as soon as the deploy phase begins', () => {
            const title = buildDeployProgressTitle({ currentPhase: 'deploy', completedPhases: ['scaffold'] });
            assert.ok(title.includes('Deploying'), `expected the active title to say "Deploying", got: ${title}`);
        });
    });

    suite('buildDeployProgressMessage', () => {
        test('warns that a chat confirmation is still coming while scaffolding', () => {
            const message = buildDeployProgressMessage(stepsFor({}));
            assert.ok(message.includes('Chat'), `expected the scaffold message to point at Chat, got: ${message}`);
        });

        test('warns that chat may still ask for deployment confirmation', () => {
            const signals: DeployProgressSignals = { currentPhase: 'deploy', completedPhases: ['scaffold'] };
            const message = buildDeployProgressMessage(stepsFor(signals));

            assert.ok(message.includes('Chat'), `expected the gate message to point at Chat, got: ${message}`);
            assert.ok(/confirm/i.test(message), `expected the message to mention confirmation, got: ${message}`);
        });

        test('changes as the pipeline moves from scaffolding through provisioning to verifying', () => {
            const provisioningSignals: DeployProgressSignals = { currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'in-progress' };

            const scaffolding = buildDeployProgressMessage(stepsFor({}));
            const provisioning = buildDeployProgressMessage(stepsFor(provisioningSignals));
            const verifying = buildDeployProgressMessage(stepsFor({ deployStatus: 'succeeded' }));

            assert.strictEqual(new Set([scaffolding, provisioning, verifying]).size, 3);
        });

        test('falls back to the scaffolding copy when no step is active', () => {
            const done = stepsFor({ completedPhases: ['scaffold', 'deploy'], deployStatus: 'succeeded' });
            assert.strictEqual(buildDeployProgressMessage(done), buildDeployProgressMessage(stepsFor({})));
        });
    });

    suite('parseDeployProgressContext', () => {
        test('reads the phase fields the progress view depends on', () => {
            const parsed = parseDeployProgressContext(JSON.stringify({
                sessionId: 'abc',
                currentPhase: 'deploy',
                completedPhases: ['prereq', 'prepare', 'scaffold'],
                statusSummary: '  Provisioning resources  ',
            }));

            assert.deepStrictEqual(parsed, {
                currentPhase: 'deploy',
                completedPhases: ['prereq', 'prepare', 'scaffold'],
            });
        });

        test('returns no signals for a half-written or non-JSON file', () => {
            assert.deepStrictEqual(parseDeployProgressContext('{"currentPhase":'), {});
            assert.deepStrictEqual(parseDeployProgressContext(''), {});
            assert.deepStrictEqual(parseDeployProgressContext('null'), {});
            assert.deepStrictEqual(parseDeployProgressContext('[]').currentPhase, undefined);
        });

        test('drops fields with unexpected types instead of throwing', () => {
            const parsed = parseDeployProgressContext(JSON.stringify({
                currentPhase: 7,
                completedPhases: ['scaffold', 3, null],
            }));

            assert.strictEqual(parsed.currentPhase, undefined);
            assert.deepStrictEqual(parsed.completedPhases, ['scaffold']);
        });
    });

    suite('parseDeployResultStatus', () => {
        test('reads each known status', () => {
            for (const status of ['in-progress', 'succeeded', 'failed'] as const) {
                assert.strictEqual(parseDeployResultStatus(JSON.stringify({ status })), status);
            }
        });

        test('ignores unknown, missing, or unparseable statuses', () => {
            assert.strictEqual(parseDeployResultStatus(JSON.stringify({ status: 'queued' })), undefined);
            assert.strictEqual(parseDeployResultStatus(JSON.stringify({})), undefined);
            assert.strictEqual(parseDeployResultStatus('not json'), undefined);
        });
    });
});
