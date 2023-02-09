/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, callWithTelemetryAndErrorHandlingSync, IActionContext } from "@microsoft/vscode-azext-utils";

interface WrapFunctionsInTelemetryOptions {
    /**
     * Called before each function is executed. Intended for adding telemetry properties.
     */
    beforeHook?(context: IActionContext): void;
    /**
     * Optionally add a prefix to all function callbackIds.
     */
    callbackIdPrefix?: string;
}

type AsyncFunctions<T extends Record<string, (...args: unknown[]) => unknown | Promise<unknown>>> = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    [P in keyof T]: AsyncFunction<T[P]>;
};

type AsyncFunction<T extends (...args: unknown[]) => Promise<unknown> | unknown> = (...args: Parameters<T>) => ReturnType<T> extends Promise<infer TPromise> ? Promise<TPromise> : Promise<ReturnType<T>>;

/**
 * Wraps a set of functions in telemetry and error handling. Returned functions are always async.
 *
 * Automatically sets the following on context:
 * ```
 * context.errorHandling.rethrow = true;
 * context.errorHandling.suppressDisplay = true;
 * context.errorHandling.suppressReportIssue = true;
 * ```
 */
export function wrapFunctionsInTelemetry<TFunctions extends Record<string, (...args: unknown[]) => unknown | Promise<unknown>>>(functions: TFunctions, options?: WrapFunctionsInTelemetryOptions): AsyncFunctions<TFunctions> {
    const wrappedFunctions = {};

    Object.entries(functions).forEach(([functionName, func]) => {
        wrappedFunctions[functionName] = (...args: Parameters<typeof func>): ReturnType<typeof func> => {
            return callWithTelemetryAndErrorHandling((options?.callbackIdPrefix ?? '') + functionName, async (context) => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                options?.beforeHook?.(context);
                return await func(...args);
            });
        }
    });

    return wrappedFunctions as AsyncFunctions<TFunctions>;
}

/**
 * Wraps a set of sync functions in telemetry and error handling.
 *
 * Automatically sets the following on context:
 * ```
 * context.errorHandling.rethrow = true;
 * context.errorHandling.suppressDisplay = true;
 * context.errorHandling.suppressReportIssue = true;
 * ```
 */
export function wrapFunctionsInTelemetrySync<TFunctions extends Record<string, (...args: unknown[]) => unknown>>(functions: TFunctions, options?: WrapFunctionsInTelemetryOptions): TFunctions {
    const wrappedFunctions = {};

    Object.entries(functions).forEach(([functionName, func]) => {
        wrappedFunctions[functionName] = (...args: Parameters<typeof func>): ReturnType<typeof func> => {
            return callWithTelemetryAndErrorHandlingSync((options?.callbackIdPrefix ?? '') + functionName, (context) => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                options?.beforeHook?.(context);
                return func(...args);
            });
        }
    });

    return wrappedFunctions as TFunctions;
}
