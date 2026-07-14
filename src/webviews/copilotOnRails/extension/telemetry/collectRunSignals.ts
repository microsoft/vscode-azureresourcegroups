/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";
import { type QualitySignals, type RunEnvironment } from "./workflowDiagnostics";

/**
 * Collects run-normalization (category 1) and accuracy/quality (category 6)
 * signals by doing a single, bounded scan of the workspace. All values are
 * counts/booleans/enums — no file contents leave this function. Best effort:
 * any failure yields a partial result rather than throwing.
 */

/** Source-file globs used for size/language/quality scans. */
const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,cs,go,java,rb,php,rs,vue,svelte}';
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/.azure/**,**/dist/**,**/out/**,**/bin/**,**/obj/**,**/.venv/**}';

/** Bounds to keep the scan fast on large repos. */
const MAX_FILES_SCANNED = 600;
const MAX_FILE_BYTES = 256 * 1024;

const EXT_TO_LANGUAGE: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
    py: 'Python', cs: 'C#', go: 'Go', java: 'Java', rb: 'Ruby', php: 'PHP', rs: 'Rust', vue: 'Vue', svelte: 'Svelte',
};

const FRONTEND_DEP_HINTS = ['react', 'react-dom', 'vue', '@angular/core', 'svelte', 'next', 'vite'];
const DATABASE_DEP_HINTS = ['pg', 'mysql', 'mysql2', 'prisma', 'sequelize', 'typeorm', 'mssql', 'sqlite3', 'mongoose', 'psycopg2', 'sqlalchemy'];

const MOCK_MARKER = /\b(mock(ed)?data|placeholder|loremipsum|dummydata|fakedata|todo:\s*replace)\b/i;

function firstWorkspaceFolder(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf-8');
    } catch {
        return undefined;
    }
}

async function readDependencyInfo(root: vscode.Uri): Promise<{ count: number; names: string[] }> {
    const content = await readText(vscode.Uri.joinPath(root, 'package.json'));
    if (!content) {
        return { count: 0, names: [] };
    }
    try {
        const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
        return { count: names.length, names: names.map((n) => n.toLowerCase()) };
    } catch {
        return { count: 0, names: [] };
    }
}

async function countRequirements(root: vscode.Uri): Promise<number | undefined> {
    const content = await readText(vscode.Uri.joinPath(root, '.azure', 'requirements.json'));
    if (!content) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(content) as { questions?: unknown[] };
        return Array.isArray(parsed.questions) ? parsed.questions.length : undefined;
    } catch {
        return undefined;
    }
}

async function countPlannedRoutes(root: vscode.Uri): Promise<number | undefined> {
    const content = await readText(vscode.Uri.joinPath(root, '.azure', 'project-plan.md'));
    if (!content) {
        return undefined;
    }
    // Count references that look like HTTP routes; a rough proxy, not content.
    const matches = content.match(/\b(GET|POST|PUT|PATCH|DELETE)\b\s+\/|\/api\//gi);
    return matches ? matches.length : 0;
}

export async function collectRunSignals(autopilot: boolean): Promise<{ environment: RunEnvironment; quality: QualitySignals }> {
    const environment: RunEnvironment = {
        extensionVersion: (ext.context.extension.packageJSON as { version?: string }).version,
        vscodeVersion: vscode.version,
        platform: process.platform,
        autopilot,
    };
    const quality: QualitySignals = {};

    const root = firstWorkspaceFolder();
    if (!root) {
        return { environment, quality };
    }

    // Dependency + plan-derived counts.
    const deps = await readDependencyInfo(root);
    environment.dependencyCount = deps.count;
    environment.requirementCount = await countRequirements(root);
    environment.plannedRouteCount = await countPlannedRoutes(root);

    // Bounded source scan for size, languages, and residual mock markers.
    let files: vscode.Uri[];
    try {
        files = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, MAX_FILES_SCANNED);
    } catch {
        files = [];
    }
    const languages = new Set<string>();
    let linesOfCode = 0;
    let residualMockMarkers = 0;
    for (const file of files) {
        const ext2 = file.path.split('.').pop()?.toLowerCase() ?? '';
        if (EXT_TO_LANGUAGE[ext2]) {
            languages.add(EXT_TO_LANGUAGE[ext2]);
        }
        let stat: vscode.FileStat | undefined;
        try {
            stat = await vscode.workspace.fs.stat(file);
        } catch {
            continue;
        }
        if (stat.size > MAX_FILE_BYTES) {
            continue;
        }
        const text = await readText(file);
        if (text === undefined) {
            continue;
        }
        linesOfCode += text.split('\n').length;
        for (const line of text.split('\n')) {
            if (MOCK_MARKER.test(line)) {
                residualMockMarkers++;
            }
        }
    }
    environment.fileCount = files.length;
    environment.linesOfCode = linesOfCode;
    environment.languages = [...languages].sort();

    // Frontend / database shape (deps + on-disk hints).
    const hasFrontendDep = FRONTEND_DEP_HINTS.some((h) => deps.names.includes(h));
    const hasDatabaseDep = DATABASE_DEP_HINTS.some((h) => deps.names.includes(h));
    const frontendDir = await pathExists(vscode.Uri.joinPath(root, 'frontend')) || await pathExists(vscode.Uri.joinPath(root, 'client'));
    const migrationsDir = await pathExists(vscode.Uri.joinPath(root, 'migrations')) || await pathExists(vscode.Uri.joinPath(root, 'prisma'));
    environment.hasFrontend = hasFrontendDep || frontendDir;
    environment.hasDatabase = hasDatabaseDep || migrationsDir;

    // Quality: diagnostics counts from the language servers (metadata only).
    let errorDiagnostics = 0;
    let warningDiagnostics = 0;
    try {
        for (const [, diags] of vscode.languages.getDiagnostics()) {
            for (const d of diags) {
                if (d.severity === vscode.DiagnosticSeverity.Error) { errorDiagnostics++; }
                else if (d.severity === vscode.DiagnosticSeverity.Warning) { warningDiagnostics++; }
            }
        }
        quality.errorDiagnostics = errorDiagnostics;
        quality.warningDiagnostics = warningDiagnostics;
    } catch {
        // Diagnostics unavailable.
    }
    quality.residualMockMarkers = residualMockMarkers;

    // Plan compliance: expected artifacts vs present on disk.
    const expected: string[] = ['backend'];
    const present: string[] = [];
    const details: string[] = [];
    // Backend is always expected; treat presence of any source as satisfied.
    if (files.length > 0) { present.push('backend'); details.push('backend: source present'); }
    else { details.push('backend: no source found'); }
    if (environment.hasFrontend) {
        expected.push('frontend');
        if (frontendDir || hasFrontendDep) { present.push('frontend'); details.push('frontend: present'); }
        else { details.push('frontend: expected but not found'); }
    }
    if (environment.hasDatabase) {
        expected.push('database');
        if (migrationsDir || hasDatabaseDep) { present.push('database'); details.push('database: present'); }
        else { details.push('database: expected but not found'); }
    }
    quality.planCompliance = {
        expected: expected.length,
        present: present.length,
        score: expected.length > 0 ? Math.round((present.length / expected.length) * 100) / 100 : 1,
        details,
    };

    return { environment, quality };
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}
