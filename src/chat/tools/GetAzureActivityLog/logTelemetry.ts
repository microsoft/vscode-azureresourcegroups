/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConvertedActivityItem } from "./convertActivityTree";
import { GetAzureActivityLogContext } from "./GetAzureActivityLogContext";

/**
 * Log telemetry for the entire activity tree (before any selection filtering)
 */
export function logActivityTelemetry(context: GetAzureActivityLogContext, activityItems: ConvertedActivityItem[]): void {
    const telemetry: TelemetryProperties = getCommonTelemetryProperties(activityItems);

    // i.e. total activities
    context.telemetry.properties.activityCount = String(activityItems.length);
    context.telemetry.properties.failedActivityCount = String(telemetry.totalFailedActivities);

    // i.e. unique command ids
    context.telemetry.properties.uniqueCallbackIds = Array.from(telemetry.callbackIds).join(',');
    context.telemetry.properties.uniqueFailedCallbackIds = Array.from(telemetry.failedCallbackIds).join(',');

    // i.e. unique command ids w/ command metadata
    context.telemetry.properties.uniqueCallbackIdsWithAttributes = Array.from(telemetry.callbackIdsWithAttributes).join(',');
    context.telemetry.properties.uniqueFailedCallbackIdsWithAttributes = Array.from(telemetry.failedCallbackIdsWithAttributes).join(',');
}

/**
 * Log telemetry for the selected activity tree items (after selection filtering)
 */
export function logSelectedActivityTelemetry(context: GetAzureActivityLogContext, selectedActivityItems: ConvertedActivityItem[]): void {
    const telemetry: TelemetryProperties = getCommonTelemetryProperties(selectedActivityItems);

    context.telemetry.properties.hasSelectedActivities = String(!!selectedActivityItems.length);
    context.telemetry.properties.missingSelectedActivities = String(selectedActivityItems.length !== context.activitySelectedCache.selectionCount);

    // i.e. total activities (selected)
    context.telemetry.properties.selectedActivityCount = String(selectedActivityItems.length);
    context.telemetry.properties.selectedFailedActivityCount = String(telemetry.totalFailedActivities);

    // i.e. unique command ids (selected)
    context.telemetry.properties.selectedUniqueCallbackIds = Array.from(telemetry.callbackIds).join(',');
    context.telemetry.properties.selectedUniqueFailedCallbackIds = Array.from(telemetry.failedCallbackIds).join(',');

    // i.e. unique command ids w/ command metadata (selected)
    context.telemetry.properties.selectedUniqueCallbackIdsWithAttributes = Array.from(telemetry.callbackIdsWithAttributes).join(',');
    context.telemetry.properties.selectedUniqueFailedCallbackIdsWithAttributes = Array.from(telemetry.failedCallbackIdsWithAttributes).join(',');
}

type TelemetryProperties = {
    callbackIds: Set<string>;
    failedCallbackIds: Set<string>;
    callbackIdsWithAttributes: Set<string>;
    failedCallbackIdsWithAttributes: Set<string>;
    totalFailedActivities: number;
};

/**
 * A reusable telemetry helper for counting common activity item properties
 */
function getCommonTelemetryProperties(activityItems: ConvertedActivityItem[]): TelemetryProperties {
    return activityItems.reduce<TelemetryProperties>((telemetry, activityItem) => {
        if (activityItem.error) {
            telemetry.totalFailedActivities++;
        }

        if (activityItem.callbackId) {
            telemetry.callbackIds.add(activityItem.callbackId);
            if (activityItem.activityAttributes) {
                telemetry.callbackIdsWithAttributes.add(activityItem.callbackId);
            }


            if (activityItem.error) {
                telemetry.failedCallbackIds.add(activityItem.callbackId);
                if (activityItem.activityAttributes) {
                    telemetry.failedCallbackIdsWithAttributes.add(activityItem.callbackId);
                }
            }
        }

        return telemetry;

    }, {
        callbackIds: new Set(),
        failedCallbackIds: new Set(),
        callbackIdsWithAttributes: new Set(),
        failedCallbackIdsWithAttributes: new Set(),
        totalFailedActivities: 0,
    })
}
