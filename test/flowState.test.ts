/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { copilotOnRailsCommandIds } from '../src/webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { computeFlowState, phaseToStageIndex, PLAN_STATUS, type FlowSignals } from '../src/webviews/copilotOnRails/extension/flowState';

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
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.planning }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'plan');
        assert.strictEqual(flow.status, 'awaitingApproval');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openScaffoldPlanView);
    });

    test('project plan (approved) but scaffold launched => scaffold in progress', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.approved, lastPhase: 'scaffold' }));
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
        const awaiting = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.planning }));
        const running = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.planning, lastPhase: 'scaffold' }));
        assert.strictEqual(awaiting?.status, 'awaitingApproval');
        assert.strictEqual(running?.status, 'inProgress');
    });

    test('scaffolded => scaffold completed, continues to local development', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.scaffolded }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'scaffold');
        assert.strictEqual(flow.status, 'completed');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startLocalDevelopment);
    });

    test('"ready" is treated the same as "scaffolded"', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.ready }));
        assert.strictEqual(flow?.status, 'completed');
        assert.strictEqual(flow?.phase, 'scaffold');
    });

    test('awaiting ux approval => reopen the frontend preview gate (never relaunch scaffold)', () => {
        // Scaffolding is done and produced a frontend preview that the user has
        // not signed off on yet. Resuming must reopen the preview/approval gate,
        // not relaunch the scaffold (the frontend already exists) or jump into
        // integration (the UI is not approved).
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.awaitingUxApproval }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'integrate');
        assert.strictEqual(flow.status, 'awaitingApproval');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openFrontendPreviewView);
    });

    test('awaiting integration => integrate awaiting approval (never relaunch scaffold)', () => {
        // Scaffolding is done; the frontend already exists. Resuming must route to
        // the integrate agent, not the scaffold agent (which would re-open the
        // frontend preview before the frontend is re-scaffolded).
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.awaitingIntegration }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'integrate');
        assert.strictEqual(flow.status, 'awaitingApproval');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startProjectIntegrate);
    });

    test('awaiting integration + integrate launched => integrate in progress', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.awaitingIntegration, lastPhase: 'integrate' }));
        assert.strictEqual(flow?.phase, 'integrate');
        assert.strictEqual(flow?.status, 'inProgress');
        assert.strictEqual(flow?.resumeCommandId, copilotOnRailsCommandIds.startProjectIntegrate);
    });

    test('integrating => integrate in progress (resume mid-integration)', () => {
        // A run was interrupted while integration was underway. Resuming must
        // continue integration regardless of the cached lastPhase.
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.integrating }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'integrate');
        assert.strictEqual(flow.status, 'inProgress');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startProjectIntegrate);
    });

    test('integrated => scaffold complete, continues to local development', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.integrated }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'scaffold');
        assert.strictEqual(flow.status, 'completed');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startLocalDevelopment);
    });

    test('integrated + integrate launched => still complete, no stale integrate resume', () => {
        // After integration finishes, the cached lastPhase is still 'integrate'.
        // The terminal `integrated` status must not re-offer an "Integrating"
        // resume — it stays completed so the project-creation stage's Resume
        // node disappears.
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.integrated, lastPhase: 'integrate' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'scaffold');
        assert.strictEqual(flow.status, 'completed');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startLocalDevelopment);
    });

    test('scaffolded + integrate launched => integrate in progress', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.scaffolded, lastPhase: 'integrate' }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'integrate');
        assert.strictEqual(flow.status, 'inProgress');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startProjectIntegrate);
    });

    test('debug plan (planning) with no launch => local dev awaiting approval', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.scaffolded, debugPlanStatus: PLAN_STATUS.planning }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'localDev');
        assert.strictEqual(flow.status, 'awaitingApproval');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.openLocalPlanView);
    });

    test('debug plan (planning) + localDev launched => local dev in progress', () => {
        const flow = computeFlowState(signals({ debugPlanStatus: PLAN_STATUS.approved, lastPhase: 'localDev' }));
        assert.strictEqual(flow?.status, 'inProgress');
        assert.strictEqual(flow?.phase, 'localDev');
    });

    test('debug plan implemented => local dev complete, continues to deploy', () => {
        const flow = computeFlowState(signals({ projectPlanStatus: PLAN_STATUS.scaffolded, debugPlanStatus: PLAN_STATUS.implemented }));
        assert.ok(flow);
        assert.strictEqual(flow.phase, 'localDev');
        assert.strictEqual(flow.status, 'completed');
        assert.strictEqual(flow.resumeCommandId, copilotOnRailsCommandIds.startDeployment);
    });

    test('deployment plan present takes precedence over earlier phases', () => {
        const flow = computeFlowState(signals({
            projectPlanStatus: PLAN_STATUS.scaffolded,
            debugPlanStatus: PLAN_STATUS.implemented,
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
