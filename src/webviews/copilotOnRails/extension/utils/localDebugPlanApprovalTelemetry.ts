/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type LocalPlanData } from "../../views/utils/parseLocalDebugPlanMarkdown";
import { getLocalDebugPlanTelemetry, LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX } from "./localDebugPlanTelemetryUtils";

/**
 * Records the PII-safe debug-plan summary properties that the "submit debug plan approval" action emits.
 *
 * This is the single implementation shared by both approval paths: the manual local-plan-view approval
 * ({@link LocalPlanViewController}) and the autopilot auto-approval. Callers own opening the
 * `submitDebugPlanApproval` telemetry action and setting `approvalOutcome`; this only derives and stamps
 * the plan summary props. Any parsing error is swallowed and flagged via a `parseFailed` property so
 * telemetry never blocks the approval flow.
 */
export function recordLocalDebugPlanApprovalTelemetry(context: CopilotOnRailsContext, planData: LocalPlanData): void {
    try {
        const telemetry = getLocalDebugPlanTelemetry(planData);
        for (const [key, value] of Object.entries(telemetry)) {
            setCorProp(context, `${LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX}${key}`, value);
        }
    } catch {
        // Telemetry extraction must never block the approval flow; swallow any parsing errors.
        setCorProp(context, `${LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX}parseFailed`, true);
    }
}
