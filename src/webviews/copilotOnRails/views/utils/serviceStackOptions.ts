/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getServiceStackKind, normalizeScaffoldPlanComponent, type ScaffoldPlanComponent, type ScaffoldPlanData, type ScaffoldPlanSection, type ServiceStackKind } from './parseScaffoldPlanMarkdown';

const editableOptions: Record<string, string[]> = {
    'Language': ['JavaScript', 'TypeScript', 'Python', 'C# (.NET)'],
    'Runtime': ['Node', 'Deno', 'Bun', 'CPython', 'PyPy', '.NET'],
    'Backend': ['Azure Functions'],
    'Frontend': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'Blazor', 'None'],
    'Framework': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'Blazor'],
    'Package Manager': ['npm', 'yarn', 'pnpm', 'pip', 'poetry', 'uv', 'dotnet (NuGet)'],
    'Test Runner': ['vitest', 'jest', 'mocha', 'pytest', 'unittest', 'xUnit', 'NUnit', 'MSTest'],
};

export const languageDependentFields: readonly ScaffoldPlanComponent[] = ['Runtime', 'Frontend', 'Framework', 'Package Manager', 'Test Runner'];

const languageDependentOptions: Record<string, Record<string, string[]>> = {
    'Runtime': {
        'TypeScript': ['Node', 'Deno', 'Bun'],
        'JavaScript': ['Node', 'Deno', 'Bun'],
        'Python': ['CPython', 'PyPy'],
        'C# (.NET)': ['.NET'],
    },
    'Frontend': {
        'TypeScript': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'None'],
        'JavaScript': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'None'],
        'Python': ['React + Vite', 'Vue + Vite', 'Angular', 'Svelte', 'None'],
        'C# (.NET)': ['Blazor', 'React + Vite', 'Vue + Vite', 'Angular', 'Svelte', 'None'],
    },
    'Framework': {
        'TypeScript': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte'],
        'JavaScript': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte'],
        'Python': ['React + Vite', 'Vue + Vite', 'Svelte'],
        'C# (.NET)': ['Blazor', 'React + Vite', 'Vue + Vite'],
    },
    'Package Manager': {
        'TypeScript': ['npm', 'pnpm', 'yarn'],
        'JavaScript': ['npm', 'pnpm', 'yarn'],
        'Python': ['pip', 'poetry', 'uv'],
        'C# (.NET)': ['dotnet (NuGet)'],
    },
    'Test Runner': {
        'TypeScript': ['vitest', 'jest', 'mocha'],
        'JavaScript': ['vitest', 'jest', 'mocha'],
        'Python': ['pytest', 'unittest'],
        'C# (.NET)': ['xUnit', 'NUnit', 'MSTest'],
    },
};

export function isBackendFrameworkField(field: ScaffoldPlanComponent, serviceKind: ServiceStackKind): boolean {
    return field === 'Backend' || (field === 'Framework' && serviceKind === 'backend');
}

export function optionsForField(field: ScaffoldPlanComponent, language: string | undefined, serviceKind: ServiceStackKind): string[] | undefined {
    if (isBackendFrameworkField(field, serviceKind)) {
        return editableOptions.Backend;
    }
    if (field === 'Language' && serviceKind === 'frontend') {
        return ['JavaScript', 'TypeScript'];
    }
    const byLanguage = languageDependentOptions[field];
    const key = language?.trim();
    return (key && byLanguage?.[key]) || editableOptions[field];
}

export function matchServiceStackOption(value: string | undefined, options: readonly string[], field?: ScaffoldPlanComponent): string | undefined {
    const normalized = (field === 'Runtime' ? value?.split(/[;,(]/, 1)[0] : value)?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    return options.find(option => {
        const name = option.toLowerCase();
        return normalized === name || (
            normalized.startsWith(`${name} `)
            && /^v?\d+(?:\.\d+)*(?:\.x)?(?:\s+lts)?$/.test(normalized.slice(name.length).trim())
        );
    });
}

export function isLimitedSupportBackendLanguage(value: string): boolean {
    const normalized = value.toLowerCase();
    return normalized.includes('.net') || normalized.includes('c#');
}

export function isServiceStackSection(section: ScaffoldPlanSection): boolean {
    return (section.content ?? []).some(content =>
        content.type === 'table' && content.rows.some(row => normalizeScaffoldPlanComponent(row[0] ?? '') === 'Language'),
    );
}

export function hasMissingBackendFramework(plan: ScaffoldPlanData): boolean {
    return plan.sections.some(section => {
        if (!isServiceStackSection(section)) {
            return false;
        }
        const serviceKind = getServiceStackKind(section);
        return section.content.some(content => content.type === 'table' && content.rows.some(row => {
            const field = normalizeScaffoldPlanComponent(row[0] ?? '');
            return field !== undefined && isBackendFrameworkField(field, serviceKind)
                && (row.length < 2 || row.slice(1).some(value => !value.trim()));
        }));
    });
}
