/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AvailableChatModel {
    readonly id: string;
    readonly vendor: string;
    readonly family: string;
    readonly version: string;
    readonly name: string;
}

export const supportedModelNames = ['Opus', 'Sonnet', 'GPT Sol', 'GPT Terra'] as const;

export function getSupportedModelName(...identifiers: string[]): typeof supportedModelNames[number] | undefined {
    const modelIdentifiers = identifiers.join(' ');
    return supportedModelNames.find(name => {
        const identifyingWord = name.split(' ').at(-1);
        return identifyingWord && new RegExp(`\\b${identifyingWord}\\b`, 'i').test(modelIdentifiers);
    });
}

export function getDefaultOpusModelOption(models: readonly AvailableChatModel[]): string | undefined {
    const model = models
        .filter(model => model.vendor === 'copilot' && getSupportedModelName(model.id, model.family, model.name) === 'Opus')
        .sort((a, b) =>
            a.version.localeCompare(b.version, undefined, { numeric: true, sensitivity: 'base' })
            || a.name.localeCompare(b.name))[0];

    return model ? `${model.name} (${model.vendor})` : undefined;
}

/**
 * Resolves a persisted model selection to the exact model object that will be passed to chat.
 */
export function resolveAvailableChatModel(displayName: string, models: readonly AvailableChatModel[]): AvailableChatModel | undefined {
    const selectNewest = (matches: readonly AvailableChatModel[]): AvailableChatModel | undefined =>
        [...matches].sort((a, b) =>
            b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' })
            || a.name.localeCompare(b.name)
            || a.id.localeCompare(b.id))[0];

    const qualifiedNameMatch = displayName.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    if (qualifiedNameMatch) {
        const [, name, vendor] = qualifiedNameMatch;
        const match = selectNewest(models.filter(model => model.name === name.trim() && model.vendor === vendor));
        if (match) {
            return match;
        }
    }

    const canonicalIdMatch = models.find(model => `${model.vendor}/${model.id}` === displayName);
    if (canonicalIdMatch) {
        return canonicalIdMatch;
    }

    return selectNewest(models.filter(model => model.name === displayName))
        ?? selectNewest(models.filter(model => model.id === displayName));
}

/**
 * Returns the currently available supported Copilot models as qualified names
 * that VS Code can resolve when opening chat.
 */
export function getSupportedModelOptions(models: readonly AvailableChatModel[]): string[] {
    const matchingModels = models
        .map(model => ({ supportedName: getSupportedModelName(model.id, model.family, model.name), model }))
        .filter((entry): entry is { supportedName: typeof supportedModelNames[number]; model: AvailableChatModel } =>
            entry.model.vendor === 'copilot' && entry.supportedName !== undefined)
        .sort((a, b) =>
            supportedModelNames.indexOf(a.supportedName) - supportedModelNames.indexOf(b.supportedName)
            || b.model.version.localeCompare(a.model.version, undefined, { numeric: true, sensitivity: 'base' })
            || a.model.name.localeCompare(b.model.name));

    return [...new Set(matchingModels.map(({ model }) => `${model.name} (${model.vendor})`))];
}
