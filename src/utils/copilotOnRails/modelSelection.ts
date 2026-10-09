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

/** Defer to whatever model is already highlighted in VS Code Chat by omitting modelSelector (not the same as auto). */
export const DEFAULT_CHAT_MODEL = 'default';
export const AUTO_CHAT_MODEL = 'Auto';

export function getModelPickerOptions(models: readonly AvailableChatModel[], initialModel?: string): string[] {
    const options = getSupportedModelOptions(models);
    if (options.length === 0) {
        return [];
    }
    const pickerOptions = [...options, AUTO_CHAT_MODEL];
    return initialModel === DEFAULT_CHAT_MODEL ? [DEFAULT_CHAT_MODEL, ...pickerOptions] : pickerOptions;
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
        .filter(model => model.id !== 'auto' && model.name !== AUTO_CHAT_MODEL
            && getSupportedModelName(model.id, model.family, model.name) === 'Opus')
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

export function resolveCopilotHarnessModelSelector(
    displayName: string,
    models: readonly AvailableChatModel[],
): { id: string; vendor: string } | undefined {
    if (displayName === DEFAULT_CHAT_MODEL) {
        return undefined;
    }
    if (displayName === AUTO_CHAT_MODEL) {
        return { id: 'auto', vendor: 'agent-host-copilotcli' };
    }
    const model = resolveAvailableChatModel(displayName, models);
    // Agent Host drops extension-host model identifiers instead of applying them.
    return model ? { id: model.id, vendor: 'agent-host-copilotcli' } : undefined;
}

/**
 * Filters a vendor-scoped API result to supported model families and returns
 * display names for the model picker.
 */
export function getSupportedModelOptions(models: readonly AvailableChatModel[]): string[] {
    const matchingModels = models
        .filter(model => model.id !== 'auto' && model.name !== AUTO_CHAT_MODEL)
        .map(model => ({ supportedName: getSupportedModelName(model.id, model.family, model.name), model }))
        .filter((entry): entry is { supportedName: typeof supportedModelNames[number]; model: AvailableChatModel } =>
            entry.supportedName !== undefined)
        .sort((a, b) =>
            supportedModelNames.indexOf(a.supportedName) - supportedModelNames.indexOf(b.supportedName)
            || b.model.version.localeCompare(a.model.version, undefined, { numeric: true, sensitivity: 'base' })
            || a.model.name.localeCompare(b.model.name));

    return [...new Set(matchingModels.map(({ model }) => model.name))];
}
