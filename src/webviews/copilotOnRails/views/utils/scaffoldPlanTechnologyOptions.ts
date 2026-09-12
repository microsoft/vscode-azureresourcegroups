/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ScaffoldPlanSection } from './parseScaffoldPlanMarkdown';

export type ServiceStackKind = 'backend' | 'frontend' | 'unknown';

const editableOptions: Record<string, string[]> = {
    'Language': ['JavaScript', 'TypeScript', 'Python', 'C# (.NET)'],
    'Runtime': ['Node', 'Deno', 'Bun', 'CPython', 'PyPy', '.NET'],
    'Backend': ['Azure Functions v4 (Node.js v4 model)', 'Express.js', 'Fastify', 'Flask', 'FastAPI', 'Spring Boot', 'ASP.NET Core'],
    'Frontend': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'Blazor', 'None'],
    'Package Manager': ['npm', 'yarn', 'pnpm', 'pip', 'poetry', 'uv', 'dotnet (NuGet)'],
    'Test Runner': ['vitest', 'jest', 'mocha', 'pytest', 'unittest', 'xUnit', 'NUnit', 'MSTest'],
};

const sharedLanguageOptions: Record<string, Record<string, string[]>> = {
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

const backendFrameworkOptions: Record<string, string[]> = {
    'TypeScript': ['Azure Functions', 'Fastify', 'Express'],
    'JavaScript': ['Azure Functions', 'Fastify', 'Express'],
    'Python': ['Azure Functions', 'FastAPI', 'Flask'],
    'C# (.NET)': ['Azure Functions', 'ASP.NET Core'],
};

const frontendFrameworkOptions: Record<string, string[]> = {
    'TypeScript': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte'],
    'JavaScript': ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte'],
    'Python': ['React + Vite', 'Vue + Vite', 'Svelte'],
    'C# (.NET)': ['Blazor', 'React + Vite', 'Vue + Vite'],
};

const allFrameworks = [...new Set([
    ...Object.values(backendFrameworkOptions).flat(),
    ...Object.values(frontendFrameworkOptions).flat(),
])];

const fullySupportedOptions: Record<string, Set<string>> = {
    'Runtime': new Set(['Node', 'CPython', '.NET']),
    'Frontend': new Set(['React + Vite', 'Vue + Vite', 'Angular', 'Svelte', 'Blazor', 'None']),
    'Package Manager': new Set(['npm', 'pnpm', 'pip', 'poetry', 'dotnet (NuGet)']),
    'Test Runner': new Set(['vitest', 'jest', 'mocha', 'pytest', 'xUnit', 'NUnit', 'MSTest']),
};

const frontendLanguageOptions = ['JavaScript', 'TypeScript'];
const legacyRuntimeOptions = ['JavaScript', 'TypeScript', 'Python', 'C# (.NET)'];

export const languageDependentFields = ['Runtime', 'Frontend', 'Framework', 'Package Manager', 'Test Runner'];

export function isServiceStackSection(section: ScaffoldPlanSection): boolean {
    return section.content.some(content => {
        if (content.type !== 'table') {
            return false;
        }
        const rowLabels = new Set(content.rows.map(row => row[0]?.trim()));
        return rowLabels.has('Language') || rowLabels.has('Backend') || rowLabels.has('Frontend');
    });
}

export function getServiceStackKind(section: ScaffoldPlanSection): ServiceStackKind {
    const tables = section.content.filter(content => content.type === 'table');

    for (const table of tables) {
        const rowLabels = new Set(table.rows.map(row => row[0]?.trim()));
        if (rowLabels.has('Backend')) {
            return 'backend';
        }
        if (rowLabels.has('Frontend')) {
            return 'frontend';
        }

        const frameworkRow = table.rows.find(row => row[0]?.trim() === 'Framework');
        const frameworkValues = frameworkRow?.slice(1).map(value => value.trim()) ?? [];
        if (frameworkValues.some(isBackendFramework)) {
            return 'backend';
        }
        if (frameworkValues.some(isFrontendFramework)) {
            return 'frontend';
        }
    }

    const titleRole = section.title.split(/\s+(?:\u2014|\u2013|-)\s+/).at(-1) ?? section.title;
    return classifyRoleText(titleRole) ?? classifyRoleText(section.title) ?? 'unknown';
}

export function optionsForField(
    field: string,
    language: string | undefined,
    serviceKind: ServiceStackKind,
    usesLanguageRow = true,
): string[] | undefined {
    const normalizedField = field.trim();
    const normalizedLanguage = language?.trim();

    if (normalizedField === 'Runtime' && !usesLanguageRow) {
        return legacyRuntimeOptions;
    }
    if (normalizedField === 'Frontend' && !usesLanguageRow) {
        return editableOptions.Frontend;
    }
    if (normalizedField === 'Language' && serviceKind === 'frontend') {
        return frontendLanguageOptions;
    }

    if (normalizedField === 'Framework') {
        const optionsByLanguage = serviceKind === 'backend'
            ? backendFrameworkOptions
            : serviceKind === 'frontend'
                ? frontendFrameworkOptions
                : undefined;
        if (!optionsByLanguage) {
            return allFrameworks;
        }
        return normalizedLanguage
            ? optionsByLanguage[normalizedLanguage] ?? [...new Set(Object.values(optionsByLanguage).flat())]
            : [...new Set(Object.values(optionsByLanguage).flat())];
    }

    const optionsByLanguage = sharedLanguageOptions[normalizedField];
    if (optionsByLanguage && normalizedLanguage) {
        return optionsByLanguage[normalizedLanguage] ?? editableOptions[normalizedField];
    }

    return editableOptions[normalizedField];
}

export function isFullySupportedOption(
    field: string,
    value: string,
    serviceKind: ServiceStackKind,
    usesLanguageRow = true,
): boolean | undefined {
    const normalizedField = field.trim();
    if (normalizedField === 'Runtime' && !usesLanguageRow) {
        return undefined;
    }
    if (normalizedField === 'Framework') {
        if (serviceKind === 'backend') {
            return isAzureFunctionsFramework(value);
        }
        if (serviceKind === 'frontend') {
            return fullySupportedOptions.Frontend.has(value.trim());
        }
        return undefined;
    }

    return fullySupportedOptions[normalizedField]?.has(value.trim());
}

function classifyRoleText(value: string): Exclude<ServiceStackKind, 'unknown'> | undefined {
    if (/\b(api|backend|worker|functions?)\b/i.test(value)) {
        return 'backend';
    }
    if (/\b(frontend|web app|spa|client-side|client app)\b/i.test(value)) {
        return 'frontend';
    }
    return undefined;
}

function isBackendFramework(value: string): boolean {
    return isAzureFunctionsFramework(value)
        || /^(express(?:\.js)?|fastify|flask|fastapi|spring boot|asp\.net core)$/i.test(value.trim());
}

function isAzureFunctionsFramework(value: string): boolean {
    return /^azure functions?(?:\b.*)?$/i.test(value.trim());
}

function isFrontendFramework(value: string): boolean {
    return /^(react\s*\+\s*vite|next\.js|vue\s*\+\s*vite|angular|svelte|blazor|none)$/i.test(value.trim());
}
