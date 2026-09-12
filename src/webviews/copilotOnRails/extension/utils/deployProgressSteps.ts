/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LoadingStep } from "../../views/utils/viewConfigTypes";

/**
 * Terminal-or-open status recorded in the App Onboard `deploy-result.json` artifact.
 * Mirrors `DeployStatus` in the vendored `deploy/references/deploy-schemas.ts`.
 */
export type DeployResultStatus = 'in-progress' | 'succeeded' | 'failed';

/**
 * The subset of the App Onboard session artifacts the deployment progress view reads.
 * Everything is optional: the agent writes these files incrementally, so any field can
 * be missing or malformed while a phase is mid-flight.
 */
export type DeployProgressSignals = {
    /** `context.json` → `currentPhase`. */
    currentPhase?: string;
    /** `context.json` → `completedPhases`. */
    completedPhases?: readonly string[];
    /** `deploy-result.json` → `status`, present only once the deploy phase has opened its result record. */
    deployStatus?: DeployResultStatus;
};

/** Step identifiers, exported so tests and callers don't duplicate the string literals. */
export const deployProgressStepIds = {
    scaffold: 'scaffold',
    provision: 'provision',
    verify: 'verify',
} as const;

/**
 * Reads the App Onboard `context.json` artifact into the signals the progress view needs.
 * Returns an empty object rather than throwing: the file is written incrementally by the
 * agent, so a partial or invalid read just means "no new information yet".
 */
export function parseDeployProgressContext(content: string): DeployProgressSignals {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return {};
    }

    const { currentPhase, completedPhases } = parsed as Record<string, unknown>;
    return {
        currentPhase: typeof currentPhase === 'string' ? currentPhase : undefined,
        completedPhases: Array.isArray(completedPhases)
            ? completedPhases.filter((phase): phase is string => typeof phase === 'string')
            : undefined,
    };
}

/** Reads the `status` field out of a (possibly partially written) `deploy-result.json`. */
export function parseDeployResultStatus(content: string): DeployResultStatus | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
    }
    const status = (parsed as Record<string, unknown>).status;
    return status === 'in-progress' || status === 'succeeded' || status === 'failed' ? status : undefined;
}

/**
 * Whether the pipeline is parked at its deploy approval gate, waiting on the user.
 *
 * The pipeline has two mandatory gates: approving the plan authorises *scaffolding* only, and a
 * second "🚀 Ready to deploy?" prompt in Chat authorises spending money on resources. `context.json`
 * flips to `currentPhase: "deploy"` at the post-scaffold checkpoint — which happens *before* that
 * second gate is presented — so the phase alone must never be read as "deploying".
 *
 * The reliable discriminator is `deploy-result.json`: the agent opens that record before its very
 * first `az` command, so scaffolding being finished with no record yet means nothing is running
 * and the gate is waiting for an answer.
 */
export function isAwaitingDeployApproval(signals: DeployProgressSignals): boolean {
    const completed = new Set(signals.completedPhases ?? []);
    return isScaffoldDone(signals) && signals.deployStatus === undefined && !completed.has('deploy');
}

function isScaffoldDone(signals: DeployProgressSignals): boolean {
    const completed = new Set(signals.completedPhases ?? []);
    // A deploy-result record can only exist once scaffolding produced something to deploy, so
    // treat it as scaffold evidence even if `completedPhases` wasn't refreshed.
    return completed.has('scaffold') || completed.has('deploy')
        || signals.currentPhase === 'deploy' || signals.deployStatus !== undefined;
}

/**
 * Maps the observable App Onboard artifacts onto the three post-approval deployment steps.
 *
 * Approving the deployment plan happens at the pipeline's *scaffold* gate, so the work still
 * ahead of the user is: generate IaC → provision + deploy → verify. Each step's status is derived
 * only from evidence on disk (`completedPhases`, `currentPhase`, and whether `deploy-result.json`
 * exists yet) so the view never claims progress the agent hasn't actually made.
 */
export function buildDeployProgressSteps(signals: DeployProgressSignals): LoadingStep[] {
    const completed = new Set(signals.completedPhases ?? []);
    const deployStatus = signals.deployStatus;
    const scaffoldDone = isScaffoldDone(signals);
    const awaitingApproval = isAwaitingDeployApproval(signals);

    // A terminal failure always wins: the agent can mark the deploy phase complete in
    // `completedPhases` even when the deployment itself did not succeed.
    const deployFailed = deployStatus === 'failed';
    // The agent opens `deploy-result.json` with `status: "in-progress"` *before* running its first
    // Azure command, so the record merely existing means provisioning started — not that it ended.
    const deployFinished = !deployFailed && (deployStatus === 'succeeded' || completed.has('deploy'));

    const steps: LoadingStep[] = [
        {
            id: deployProgressStepIds.scaffold,
            label: vscode.l10n.t('Generating infrastructure code'),
            status: scaffoldDone ? 'done' : 'active',
        },
        {
            id: deployProgressStepIds.provision,
            label: vscode.l10n.t('Provisioning Azure resources'),
            // Stays `pending` while the deploy gate is unanswered: nothing is being provisioned
            // yet, and a spinner here would imply work is underway when the agent is waiting.
            status: !scaffoldDone || awaitingApproval
                ? 'pending'
                : deployFailed ? 'failed' : deployFinished ? 'done' : 'active',
        },
        {
            id: deployProgressStepIds.verify,
            label: vscode.l10n.t('Verifying your deployment'),
            status: deployFailed
                ? 'pending'
                : completed.has('deploy') ? 'done' : deployFinished ? 'active' : 'pending',
        },
    ];

    return steps;
}

/** Spinner heading, which must not promise deployment while the deploy gate is still unanswered. */
export function buildDeployProgressTitle(signals: DeployProgressSignals): string {
    return isAwaitingDeployApproval(signals)
        ? vscode.l10n.t('Ready to deploy to Azure')
        : vscode.l10n.t('Deploying your project to Azure…');
}

/** Supporting copy shown under the spinner, matched to the step that is currently running. */
export function buildDeployProgressMessage(steps: readonly LoadingStep[], signals?: DeployProgressSignals): string {
    if (signals && isAwaitingDeployApproval(signals)) {
        // Spell out that this is a second, separate confirmation. Users who approved the plan
        // reasonably read the follow-up prompt as the same question being asked twice.
        return vscode.l10n.t('Your infrastructure code is ready. Approving the plan authorized this code — creating the Azure resources needs one more confirmation. Answer "🚀 Ready to deploy?" in the Chat view to continue.');
    }

    const activeId = steps.find((step) => step.status === 'active')?.id;
    switch (activeId) {
        case deployProgressStepIds.provision:
            return vscode.l10n.t('Copilot is creating your Azure resources and deploying your code. Follow along in the Chat view.');
        case deployProgressStepIds.verify:
            return vscode.l10n.t('Copilot is health-checking the deployment. The results will open here when it finishes.');
        case deployProgressStepIds.scaffold:
        default:
            return vscode.l10n.t('Copilot is generating your infrastructure code. It will ask you to confirm in the Chat view before creating any Azure resources.');
    }
}
