/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ScaffoldPlanSection } from './parseScaffoldPlanMarkdown';

export function isBackendServiceSection(section: ScaffoldPlanSection): boolean {
    for (const content of section.content) {
        if (content.type !== 'table') {
            continue;
        }

        const frameworkValues = content.rows
            .find(row => row[0]?.trim() === 'Framework')
            ?.slice(1) ?? [];
        if (frameworkValues.some(isFrontendFramework)) {
            return false;
        }
        if (frameworkValues.some(isBackendFramework)) {
            return true;
        }
    }

    return /\b(api|backend|worker|functions?)\b/i.test(section.title);
}

export function isAzureFunctionsFramework(value: string): boolean {
    return /^azure functions?(?:\b.*)?$/i.test(value.trim());
}

function isBackendFramework(value: string): boolean {
    return isAzureFunctionsFramework(value)
        || /^(express(?:\.js)?|fastify|flask|fastapi|spring boot|asp\.net core)$/i.test(value.trim());
}

function isFrontendFramework(value: string): boolean {
    return /^(react\s*\+\s*vite|next\.js|vue\s*\+\s*vite|angular|svelte|blazor)$/i.test(value.trim());
}
