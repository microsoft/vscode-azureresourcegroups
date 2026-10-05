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
export const DEFAULT_CHAT_MODEL = 'default';

export function getModelPickerOptions(models: readonly AvailableChatModel[], initialModel?: string): string[] {
    const options = getSupportedModelOptions(models);
    return options.length > 0 && initialModel === DEFAULT_CHAT_MODEL ? [DEFAULT_CHAT_MODEL, ...options] : options;
}

export function getSupportedModelName(...identifiers: string[]): typeof supportedModelNames[number] | undefined {
    const modelIdentifiers = identifiers.join(' ');
    return supportedModelNames.find(name => {
        const identifyingWord = name.split(' ').at(-1);
        return identifyingWord && new RegExp(`\\b${identifyingWord}\\b`, 'i').test(modelIdentifiers);
    });
}

export function getDefaultOpusModelOption(models: readonly AvailableChatModel[]): string | undefined {
    const model = models
        .filter(model => getSupportedModelName(model.id, model.family, model.name) === 'Opus')
        .sort((a, b) =>
            a.version.localeCompare(b.version, undefined, { numeric: true, sensitivity: 'base' })
            || a.name.localeCompare(b.name))[0];

    return model?.name;
}

export function resolveAvailableChatModel(displayName: string, models: readonly AvailableChatModel[]): AvailableChatModel | undefined {
    const vendorMatch = displayName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (vendorMatch) {
        const [, name, vendor] = vendorMatch;
        const match = models.find(model => model.name === name.trim() && model.vendor === vendor.trim());
        if (match) {
            return match;
        }
    }

    return models.find(model => model.name === displayName)
        ?? models.find(model => model.id === displayName);
}

/**
 * Filters a vendor-scoped API result to supported model families and returns
 * display names for the model picker.
 */
export function getSupportedModelOptions(models: readonly AvailableChatModel[]): string[] {
    const matchingModels = models
        .map(model => ({ supportedName: getSupportedModelName(model.id, model.family, model.name), model }))
        .filter((entry): entry is { supportedName: typeof supportedModelNames[number]; model: AvailableChatModel } =>
            entry.supportedName !== undefined)
        .sort((a, b) =>
            supportedModelNames.indexOf(a.supportedName) - supportedModelNames.indexOf(b.supportedName)
            || b.model.version.localeCompare(a.model.version, undefined, { numeric: true, sensitivity: 'base' })
            || a.model.name.localeCompare(b.model.name));

    return [...new Set(matchingModels.map(({ model }) => model.name))];
}
