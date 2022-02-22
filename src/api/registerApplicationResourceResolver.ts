import { Disposable } from "vscode";
import { ApplicationResourceResolver } from "../api";

export const applicationResourceResolvers: Record<string, ApplicationResourceResolver> = {};

export function registerApplicationResourceResolver(provider: ApplicationResourceResolver, resourceType: string, _resourceKind?: string): Disposable {
    // not handling resource kind yet
    applicationResourceResolvers[resourceType] = provider;

    return new Disposable(() => {
        delete applicationResourceResolvers[resourceType];
    })
}
