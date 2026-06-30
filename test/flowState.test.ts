/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { copilotOnRailsCommandIds } from '../src/webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { computeFlowState, phaseToStageIndex, type FlowSignals } from '../src/webviews/copilotOnRails/extension/flowState';

function signals(overrides: Partial<FlowSignals> = {}): FlowSignals {
    return {
        hasRequirements: false,
        projectPlanStatus: undefined,
        debugPlanStatus: undefined,
        hasDeploymentPlan: false,
        lastPhase: undefined,
        ...overrides,
    };
}

suite('flowState.computeFlowState', () => {

    test('returns undefined when nothing has been started', () => {
        assert.strictEqual(computeFlowState(signals()), undefined);
    });

    test('requirements.json only => requirements phase awaiting input', () => {
        const flow = computeFlowState(signals({ hasRequirements: true }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'requirements');
        assert.strictEqual(flow.status, 'awaitingInput');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openRequirementsView);
    });

    test('plan launched but no files yet => in-progress requirements', () => {
        const flow = computeFlowState(signals({ lastPhase: 'plan' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'plan');
        assert.strictEqual(flow.status, 'inProgress');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openRequirementsView);
    });

    test('project plan (planning) with no launch => plan awaiting approval', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'planning' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'plan');
        assert.strictEqual(flow.status, 'awaitingApproval');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openScaffoldPlanView);
    });

    test('project plan (approved) but scaffold launched => scaffold in progress', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'approved', lastPhase: 'scaffold' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'scaffold');
        assert.strictEqual(flow.status, 'inProgress');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startProjectScaffold);
        // Resuming an in-progress scaffold must carry a prompt so the agent
        // continues instead of re-gathering requirements / re-requesting approval.
        assert.ok(flow.resumeArgs && flow.resumeArgs.length === 1, 'scaffold resume should pass a continue prompt');
    });

    test('plan present but not scaffolded disambiguates approval vs in-progress via lastPhase', () => {
        // Same file state, different cache => different result. This is the core
        // reason the workspaceState cache exists.
        const awaiting = computeFlowState(signals({ projectPlanStatus: 'planning' }));
        const running = computeFlowState(signals({ projectPlanStatus: 'planning', lastPhase: 'scaffold' }));
        assert.strictEqual(awaiting?.status, 'awaitingApproval');
        assert.strictEqual(running?.status, 'inProgress');
    });

    test('scaffolded => scaffold completed, continues to local development', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'scaffolded' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'scaffold');
        assert.strictEqual(flow.status, 'completed');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startLocalDevelopment);
    });

    test('"ready" is treated the same as "scaffolded"', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'ready' }));
        assert.strictEqual(flow?.status, 'completed');
        assert.strictEqual(flow?.phase, 'scaffold');
    });

    test('scaffolded + integrate launched => integrate in progress', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'scaffolded', lastPhase: 'integrate' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'integrate');
        assert.strictEqual(flow.status, 'inProgress');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startProjectIntegrate);
    });

    test('debug plan (planning) with no launch => local dev awaiting approval', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'scaffolded', debugPlanStatus: 'planning' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'localDev');
        assert.strictEqual(flow.status, 'awaitingApproval');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openLocalPlanView);
    });

    test('debug plan (planning) + localDev launched => local dev in progress', () => {
        const flow = computeFlowState(signals({ debugPlanStatus: 'approved', lastPhase: 'localDev' }));
        assert.strictEqual(flow?.status, 'inProgress');
        assert.strictEqual(flow?.phase, 'localDev');
    });

    test('debug plan implemented => local dev complete, continues to deploy', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: 'scaffolded', debugPlanStatus: 'implemented' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'localDev');
        assert.strictEqual(flow.status, 'completed');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startDeployment);
    });

    test('deployment plan present takes precedence over earlier phases', () => {
        const flow = computeFlowState(signals({
            projectPlanStatus: 'scaffolded',
            debugPlanStatus: 'implemented',
            hasDeploymentPlan: true,
        }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'deploy');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openDeploymentPlanView);
    });

    test('files win over an out-of-date cache (cache behind reality)', () => {
        // Cache still says "plan", but the deployment plan exists on disk.
        const flow = computeFlowState(signals({ hasDeploymentPlan: true, lastPhase: 'plan' }));
        assert.strictEqual(flow?.phase, 'deploy');
    });
});

suite('flowState.phaseToStageIndex', () => {
    test('requirements/plan/scaffold/integrate map to stage 0', () => {
        assert.strictEqual(phaseToStageIndex('requirements'), 0);
        assert.strictEqual(phaseToStageIndex('plan'), 0);
        assert.strictEqual(phaseToStageIndex('scaffold'), 0);
        assert.strictEqual(phaseToStageIndex('integrate'), 0);
    });

    test('localDev maps to stage 1', () => {
        assert.strictEqual(phaseToStageIndex('localDev'), 1);
    });

    test('deploy maps to stage 2', () => {
        assert.strictEqual(phaseToStageIndex('deploy'), 2);
    });
});
