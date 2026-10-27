/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from 'react';

// Classifies the value of an "Installed" cell from the agent's detection pass.
// The planner writes ✅ / ❌ / ❓ (or yes/no) once it runs the shared prerequisites
// detection; anything else (e.g. a leftover `{…}` placeholder or `—`) is treated
// as "unknown" so the card never claims a tool's status it doesn't actually know.
export type InstalledStatus = 'installed' | 'missing' | 'unknown';

export function classifyInstalled(cell: string): InstalledStatus {
    const value = cell.trim().toLowerCase();
    if (value.includes('✅') || value === 'yes' || value === 'true' || value === 'installed') {
        return 'installed';
    }
    if (value.includes('❌') || value === 'no' || value === 'false' || value === 'missing') {
        return 'missing';
    }
    return 'unknown';
}

function isComposeProvider(toolName: string): boolean {
    const name = toolName.trim().toLowerCase();
    return name.includes('docker compose') || name.includes('docker-compose') ||
        name.includes('podman compose') || name.includes('podman-compose');
}

export function classifyInstalledForRow(toolName: string, cell: string): InstalledStatus {
    if (isComposeProvider(toolName)) {
        return 'unknown';
    }
    return classifyInstalled(cell);
}

const INSTALLED_STATUS_LABEL: Record<InstalledStatus, string> = {
    installed: 'Installed',
    missing: 'Not installed',
    unknown: 'Unknown',
};

const INSTALLED_STATUS_ICON: Record<InstalledStatus, string> = {
    installed: 'codicon-pass-filled',
    missing: 'codicon-error',
    unknown: 'codicon-question',
};

export const InstalledChip = ({ status }: { status: InstalledStatus }): JSX.Element => (
    <span className={`installedChip installed-${status}`}>
        <span className={`codicon ${INSTALLED_STATUS_ICON[status]}`} />
        {INSTALLED_STATUS_LABEL[status]}
    </span>
);
