import { parseError } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";

export function delay<T = void>(ms: number, result?: T | PromiseLike<T>): Promise<T | PromiseLike<T> | undefined> {
    return new Promise(resolve => setTimeout(() => resolve(result), ms));
}

export interface Deferred<T> {
    resolve: (result: T | Promise<T>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reject: (reason: any) => void;
}

export function logErrorMessage(error: unknown): void {
    ext.outputChannel.error(parseError(error).message);
}

export function logAttemptingToReachUrlMessage(url: string): void {
    ext.outputChannel.appendLog(localize('attemptingToReachUrl', 'Attempting to reach URL "{0}"...', url));
}
