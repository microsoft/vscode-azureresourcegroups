import { Disposable } from "vscode";
import { ApplicationResourceProvider } from "../api";

export const applicationResourceProviders: ApplicationResourceProvider[] = [];

export function registerApplicationResourceProvider(
    provider: ApplicationResourceProvider
): Disposable {
    // not handling resource kind yet
    applicationResourceProviders.push(provider);

    return new Disposable(() => {
        applicationResourceProviders.splice(applicationResourceProviders.indexOf(provider), 1);
    });
}
