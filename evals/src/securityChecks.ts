/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocalAcceptanceProbe, SecurityContract } from './scenario';

export const defaultUnauthorizedStatuses = [401, 403];

export interface SecurityCheckPlan {
    name: string;
    url: string;
    kind: 'unauthenticated' | 'malformed-token' | 'public';
    expectedStatuses: number[];
    headers?: Record<string, string>;
}

/**
 * A token that is syntactically a bearer token but cannot validate. An app that only checks for
 * the presence of an Authorization header passes the unauthenticated check and fails this one.
 */
export const malformedBearerToken = 'Bearer not.a.valid.token';

/**
 * Turns the scenario's security contract into concrete requests. Protected paths default to the
 * declared backend probe URLs so a scenario only has to name its public paths.
 */
export function planSecurityChecks(
    contract: SecurityContract,
    probes: readonly LocalAcceptanceProbe[],
): SecurityCheckPlan[] {
    const expectedStatuses = contract.expectedUnauthorizedStatuses?.length
        ? [...contract.expectedUnauthorizedStatuses]
        : [...defaultUnauthorizedStatuses];
    const publicPaths = contract.publicPaths.map(normalizePath);
    const backendUrls = probes
        .filter(probe => probe.target === 'backend' && probe.url)
        .map(probe => probe.url as string);
    const origin = resolveOrigin(backendUrls);
    const protectedUrls = contract.protectedPaths?.length
        ? contract.protectedPaths.map(value => toUrl(value, origin))
        : backendUrls.filter(url => !publicPaths.includes(normalizePath(url)));
    const publicUrls = contract.publicPaths.map(value => toUrl(value, origin));

    const checks: SecurityCheckPlan[] = [];
    for (const url of unique(publicUrls)) {
        checks.push({
            name: `public ${normalizePath(url)}`,
            url,
            kind: 'public',
            expectedStatuses: [200],
        });
    }
    for (const url of unique(protectedUrls)) {
        checks.push({
            name: `unauthenticated ${normalizePath(url)}`,
            url,
            kind: 'unauthenticated',
            expectedStatuses,
        });
        checks.push({
            name: `malformed token ${normalizePath(url)}`,
            url,
            kind: 'malformed-token',
            expectedStatuses,
            headers: { Authorization: malformedBearerToken },
        });
    }
    return checks;
}

/**
 * The gate is only meaningful when it proves selective enforcement, so a plan without both a
 * liveness control and at least one protected path is rejected rather than silently passing.
 */
export function isSecurityPlanConclusive(checks: readonly SecurityCheckPlan[]): boolean {
    return checks.some(check => check.kind === 'public')
        && checks.some(check => check.kind === 'unauthenticated');
}

function resolveOrigin(urls: readonly string[]): string | undefined {
    for (const url of urls) {
        try {
            return new URL(url).origin;
        } catch {
            continue;
        }
    }
    return undefined;
}

function toUrl(value: string, origin: string | undefined): string {
    if (/^https?:\/\//u.test(value)) {
        return value;
    }
    if (!origin) {
        return value;
    }
    return `${origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

function normalizePath(value: string): string {
    try {
        return new URL(value).pathname;
    } catch {
        return value.startsWith('/') ? value : `/${value}`;
    }
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}
