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
    isAwaitingDeployApproval,
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

        test('holds provisioning at pending while the deploy approval gate is unanswered', () => {
            // `currentPhase` flips to "deploy" at the post-scaffold checkpoint, before the gate is
            // presented — so this state means "waiting on the user", not "provisioning".
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: ['prereq', 'prepare', 'scaffold'] })),
                ['done', 'pending', 'pending'],
            );
        });

        test('treats currentPhase deploy as scaffold evidence even if completedPhases lags', () => {
            assert.deepStrictEqual(
                statuses(stepsFor({ currentPhase: 'deploy', completedPhases: [] })),
                ['done', 'pending', 'pending'],
            );
        });

        test('starts provisioning only once the deploy result record appears', () => {
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

    suite('isAwaitingDeployApproval', () => {
        test('is false before scaffolding finishes — the gate has not been reached', () => {
            assert.strictEqual(isAwaitingDeployApproval({}), false);
            assert.strictEqual(isAwaitingDeployApproval({ currentPhase: 'scaffold', completedPhases: ['prepare'] }), false);
        });

        test('is true once scaffolding finishes and no deploy record exists yet', () => {
            assert.strictEqual(isAwaitingDeployApproval({ currentPhase: 'deploy', completedPhases: ['scaffold'] }), true);
        });

        test('is false as soon as the deploy record is opened, which happens before the first az command', () => {
            assert.strictEqual(
                isAwaitingDeployApproval({ currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'in-progress' }),
                false,
            );
        });

        test('is false for a finished deployment, including a failed one', () => {
            assert.strictEqual(isAwaitingDeployApproval({ completedPhases: ['scaffold', 'deploy'] }), false);
            assert.strictEqual(isAwaitingDeployApproval({ completedPhases: ['scaffold'], deployStatus: 'failed' }), false);
            assert.strictEqual(isAwaitingDeployApproval({ completedPhases: ['scaffold'], deployStatus: 'succeeded' }), false);
        });
    });

    suite('buildDeployProgressTitle', () => {
        test('does not claim a deployment is underway while the gate is unanswered', () => {
            const title = buildDeployProgressTitle({ currentPhase: 'deploy', completedPhases: ['scaffold'] });
            assert.ok(!title.includes('Deploying'), `expected the waiting title not to say "Deploying", got: ${title}`);
        });

        test('switches to the deploying title once the deploy record exists', () => {
            const title = buildDeployProgressTitle({ currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'in-progress' });
            assert.ok(title.includes('Deploying'), `expected the active title to say "Deploying", got: ${title}`);
        });
    });

    suite('buildDeployProgressMessage', () => {
        test('warns that a chat confirmation is still coming while scaffolding', () => {
            const message = buildDeployProgressMessage(stepsFor({}));
            assert.ok(message.includes('Chat'), `expected the scaffold message to point at Chat, got: ${message}`);
        });

        test('explains that the deploy gate is a second, separate confirmation', () => {
            const signals: DeployProgressSignals = { currentPhase: 'deploy', completedPhases: ['scaffold'] };
            const message = buildDeployProgressMessage(stepsFor(signals), signals);

            assert.ok(message.includes('Chat'), `expected the gate message to point at Chat, got: ${message}`);
            assert.ok(
                /one more|separate|another/i.test(message),
                `expected the gate message to explain this is an additional confirmation, got: ${message}`,
            );
        });

        test('changes as the pipeline moves from waiting through provisioning to verifying', () => {
            const awaiting: DeployProgressSignals = { currentPhase: 'deploy', completedPhases: ['scaffold'] };
            const provisioningSignals: DeployProgressSignals = { currentPhase: 'deploy', completedPhases: ['scaffold'], deployStatus: 'in-progress' };

            const scaffolding = buildDeployProgressMessage(stepsFor({}));
            const waiting = buildDeployProgressMessage(stepsFor(awaiting), awaiting);
            const provisioning = buildDeployProgressMessage(stepsFor(provisioningSignals), provisioningSignals);
            const verifying = buildDeployProgressMessage(stepsFor({ deployStatus: 'succeeded' }));

            assert.strictEqual(new Set([scaffolding, waiting, provisioning, verifying]).size, 4);
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
