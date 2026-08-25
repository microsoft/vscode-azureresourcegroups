/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Validates `.azure/integration-plan.md`, the scaffold agent's hand-off artifact.
 *
 * The integrate agent runs in a fresh session and never sees the scaffold chat, so this
 * file is the entire brief. `resources/agents/azure-project-scaffold.agent.md`
 * ("Integration hand-off artifact") enumerates exactly what it must carry, and each
 * assertion below maps to one of those bullets.
 *
 * Two properties matter more than coverage here:
 *
 * 1. **Section scoping.** Every fact is looked up inside the section that owns it. A
 *    document-wide search passes for the wrong reason — a `GET /api/health` row in the
 *    backend table satisfies a global "route inventory" check even when the inventory
 *    has been deleted outright.
 * 2. **Format independence.** Agents emit these facts as markdown table rows
 *    (`| Run command | func start |`) or as bullets (`- Run command: npm start`).
 *    Fields are read by label, so both shapes are accepted and neither is privileged.
 */

import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

/**
 * HTTP verb and a `/`-rooted path. The two may share one cell (`GET /api/items`) or sit
 * in separate table columns (`| GET | \`/api/items\` |`), so the gap may cross a pipe.
 */
const ROUTE_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE)\b[^\n]*?(\/[A-Za-z0-9/_\-{}:.]+)/gi;

/** Stores that imply schema migrations; a file or in-memory store legitimately has none. */
const MIGRATING_STORE = /\b(postgres(?:ql)?|azure sql|sql server|mysql|mariadb|mongo(?:db)?|cosmos)\b/i;

interface Section {
    heading: string;
    body: string;
    /** Heading depth; a `## Database` outranks a `### … database.ts` subsection. */
    level: number;
    /** Line the heading appeared on, so lookup order is document order. */
    position: number;
}

export function validateIntegrationPlanArtifact(
    content: string,
    options: { hasFrontend?: boolean } = {},
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];

    if (content.trim().length < 200) {
        issues.push(issue('artifactTooShort', '$', 'Integration plan is too short to brief the integrate agent.'));
    }

    const sections = parseSections(content);
    const frontendHeading = /\bfront[\s-]?end\b/i;
    const backendHeading = /\bback[\s-]?end\b/i;

    validateBackend(findSection(sections, backendHeading)?.body, issues);
    validateRoutes(findSections(sections, /\b(routes?|endpoints?)\b/i, frontendHeading), issues);
    validateDatabase(findSection(sections, /\b(database|data ?store|persistence|storage)\b/i), issues);
    validateServices(findSection(sections, /^(azure )?services\b/i)?.body, issues);

    if (options.hasFrontend) {
        validateFrontend(findSection(sections, frontendHeading, backendHeading)?.body, issues);
        validateSharedTypes(findSection(sections, /\bshared\b/i)?.body, issues);
    }

    return createValidationResult(issues);
}

/**
 * Split on ATX headings. A section body runs until the next heading of the same or a
 * higher level, so `### Schema notes` stays inside its parent `## Database`.
 */
/**
 * Command labels vary between runs: agents write `| Build |` as often as `| Build command |`.
 * `\b` after the verb is load-bearing — a bare `run` would otherwise match the `Runtime` row
 * and read back a framework name as if it were the start command.
 */
const RUN_LABEL = /\b(?:run|start|serve)(?:\s+command)?\b/i;
const BUILD_LABEL = /\bbuild(?:\s+command)?\b/i;
const DEV_LABEL = /\b(?:dev|serve|start)(?:\s+(?:command|server))?\b/i;

function parseSections(content: string): Section[] {
    const sections: Section[] = [];
    const open: Array<{ level: number; heading: string; body: string[]; position: number }> = [];

    const close = (downToLevel: number): void => {
        for (let top = open[open.length - 1]; top !== undefined && top.level >= downToLevel; top = open[open.length - 1]) {
            sections.push({ heading: top.heading, body: top.body.join('\n'), level: top.level, position: top.position });
            open.pop();
        }
    };

    let lineNumber = 0;
    for (const line of content.split(/\r?\n/)) {
        lineNumber += 1;
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const [, hashes, title] = heading ?? [];
        if (hashes !== undefined && title !== undefined) {
            close(hashes.length);
            // Drop list numbering ("3. Backend") so headings compare by name alone.
            open.push({
                level: hashes.length,
                heading: title.replace(/^\s*\d+[.)]\s*/, '').trim(),
                body: [],
                position: lineNumber,
            });
            continue;
        }
        for (const frame of open) {
            frame.body.push(line);
        }
    }
    close(1);
    // Sections close innermost-first, which is not document order. Restore document
    // order so `findSection` reads the plan the way a human does.
    return sections.sort((a, b) => a.position - b.position);
}

/**
 * Prefers the shallowest match, then the earliest. A nested `### Collection → table
 * mapping (whitelisted in src/services/database.ts)` also matches /database/, and
 * picking it over its own `## Database` parent silently hides everything the parent
 * says — which is exactly how a satisfied contract gets reported as missing.
 */
function findSection(sections: Section[], match: RegExp, exclude?: RegExp): Section | undefined {
    return findSections(sections, match, exclude)[0];
}

/**
 * Every section whose heading matches, shallowest first then document order. A heading
 * can mention a word without being about it — `## Auth (required on every route except
 * /api/health)` matches /route/ but enumerates nothing — so callers that can tell a real
 * match from an incidental one score the candidates instead of trusting the first.
 */
function findSections(sections: Section[], match: RegExp, exclude?: RegExp): Section[] {
    return sections
        .filter(s => match.test(s.heading) && !(exclude?.test(s.heading) ?? false))
        .sort((a, b) => a.level - b.level || a.position - b.position);
}

/**
 * Read a labelled field in either markdown shape:
 *   `| Run command | func start |`  (table row)
 *   `- Run command: npm start`      (bullet or prose)
 */
function readField(section: string, label: RegExp): string | undefined {
    // The label may itself be an alternation, so it is wrapped: interpolating it bare
    // would let its `|` split the whole pattern instead of just the label.
    const name = `(?:${label.source})`;
    const tableRow = new RegExp(`^\\|[^|\\n]*${name}[^|\\n]*\\|\\s*([^|\\n]+?)\\s*\\|`, 'im');
    const inlineField = new RegExp(`^\\s*[-*+]?\\s*\\**${name}[^:\\n]*?\\**\\s*:\\s*(.+)$`, 'im');
    const value = tableRow.exec(section)?.[1] ?? inlineField.exec(section)?.[1];
    const trimmed = value?.trim();
    return trimmed && !/^[-–—]$/.test(trimmed) ? trimmed : undefined;
}

/**
 * "Backend: project folder, run command, port, build command, health endpoint path."
 * The integrate agent has to start the service and probe it, so these are the facts it
 * cannot proceed without.
 */
function validateBackend(section: string | undefined, issues: ArtifactValidationIssue[]): void {
    if (section === undefined) {
        issues.push(issue('missingBackend', '$.backend', 'Integration plan must have a backend section describing the service.'));
        return;
    }
    if (!readField(section, /project folder|folder|directory/i)) {
        issues.push(issue('missingBackendFolder', '$.backend', 'Backend section must name the project folder.'));
    }
    if (!readField(section, RUN_LABEL)) {
        issues.push(issue('missingBackendCommand', '$.backend', 'Backend section must give the command that starts the service.'));
    }
    if (!readField(section, BUILD_LABEL)) {
        issues.push(issue('missingBackendBuildCommand', '$.backend', 'Backend section must give the build command.'));
    }
    // The port is a fact, not a row: agents just as often write it into the run command
    // ("`func start`, port **7071**") or the health URL ("http://localhost:7071/api/health")
    // as into a dedicated `| Port |` row. Any of those tells the integrate agent where to
    // probe, so accept a labelled port first and fall back to one stated in context.
    const labelledPort = readField(section, /port/i);
    const hasPort = (labelledPort !== undefined && /\d{2,5}/.test(labelledPort))
        || /\bport\b\D{0,20}(\d{2,5})\b/i.test(section)
        || /localhost:(\d{2,5})\b/i.test(section)
        || /127\.0\.0\.1:(\d{2,5})\b/.test(section);
    if (!hasPort) {
        issues.push(issue('missingBackendPort', '$.backend', 'Backend section must state the port the service listens on.'));
    }
    const health = readField(section, /health/i);
    if (!health || !health.includes('/')) {
        issues.push(issue('missingHealthEndpoint', '$.backend', 'Backend section must give the health endpoint path.'));
    }
}

/**
 * "API routes: the full inventory — method + path for every endpoint, so the integrate
 * agent can probe each." Scoped to its own section so a lone `GET /api/health` in the
 * backend table cannot stand in for the inventory.
 */
function validateRoutes(candidates: Section[], issues: ArtifactValidationIssue[]): void {
    if (candidates.length === 0) {
        issues.push(issue('missingRouteInventory', '$.routes', 'Integration plan must have an API route inventory section.'));
        return;
    }
    // Grade the richest candidate: a plan is only wrong if *no* section headed like an
    // inventory actually enumerates one.
    const best = Math.max(...candidates.map(s => countRoutes(s.body)));
    // Every scaffolded API carries health plus at least one resource route, so a single
    // pair means the inventory was summarised rather than enumerated.
    if (best < 2) {
        issues.push(issue('missingRouteInventory', '$.routes', 'Route inventory must enumerate method + path for every endpoint.'));
    }
}

function countRoutes(section: string): number {
    const routes = new Set<string>();
    for (const [, method, routePath] of section.matchAll(ROUTE_PATTERN)) {
        if (method !== undefined && routePath !== undefined) {
            routes.add(`${method.toUpperCase()} ${routePath}`);
        }
    }
    return routes.size;
}

/**
 * "Database: type, migration tool, migration directory, and the connection env vars.
 * Note explicitly that NO seed data is to be created."
 *
 * Migration facts are required only for stores that actually migrate — a file-backed or
 * in-memory store has no migration tool, and demanding one would be a false positive.
 */
function validateDatabase(found: Section | undefined, issues: ArtifactValidationIssue[]): void {
    if (found === undefined) {
        issues.push(issue('missingDatabase', '$.database', 'Integration plan must have a database section, or state that there is no store.'));
        return;
    }
    const section = found.body;
    // Agents state the rule wherever it reads best — in the heading
    // ("## Database — migrations to create (**NO seed data**)"), as a table row
    // ("| **Seed data** | **NONE. Do not create seed data.** |"), or as prose. All three
    // communicate the same instruction to the integrate agent, so accept the intent
    // rather than one literal phrasing.
    const stated = `${found.heading}\n${section}`;
    const declaresNoSeed = [
        /\bno seed data\b/i,
        /\bseed data\b[^.\n|]{0,40}\bnone\b/i,
        /\bnone\b[^.\n|]{0,40}\bseed data\b/i,
        /\b(?:do\s+not|don't|never)\s+(?:create|add|write|generate|insert|include)\b[^.\n|]{0,40}\bseed\b/i,
        /\bno\b[^.\n|]{0,20}\bseed\s+(?:rows|records|inserts|migrations?|scripts?|files?)\b/i,
    ].some(pattern => pattern.test(stated));
    if (!declaresNoSeed) {
        issues.push(issue('missingNoSeedRule', '$.database', 'Database section must state explicitly that NO seed data is to be created.'));
    }
    if (MIGRATING_STORE.test(section)) {
        if (!readField(section, /migration/i)) {
            issues.push(issue('missingMigrationTool', '$.database', 'A migrating store must name the migration tool and directory.'));
        }
        if (!/\b[A-Z][A-Z0-9_]{3,}\b/.test(section)) {
            issues.push(issue('missingConnectionEnvVar', '$.database', 'A migrating store must name the connection environment variable.'));
        }
    }
}

/** "Services: the service list and which are Essential vs Enhancement." */
function validateServices(section: string | undefined, issues: ArtifactValidationIssue[]): void {
    if (section === undefined) {
        issues.push(issue('missingServices', '$.services', 'Integration plan must list the services it scaffolded.'));
        return;
    }
    if (!/\b(essential|enhancement)\b/i.test(section)) {
        issues.push(issue('missingServiceClassification', '$.services', 'Services section must mark each service Essential or Enhancement.'));
    }
}

/**
 * "Frontend: project folder, build command, dev command, the API seam to swap
 * (`src/api/index.ts`) and the exact mock files to delete."
 */
function validateFrontend(section: string | undefined, issues: ArtifactValidationIssue[]): void {
    if (section === undefined) {
        issues.push(issue('missingFrontend', '$.frontend', 'Integration plan must describe the frontend for a project that has one.'));
        return;
    }
    if (!readField(section, /project folder|folder|directory/i)) {
        issues.push(issue('missingFrontendFolder', '$.frontend', 'Frontend section must name the project folder.'));
    }
    if (!readField(section, BUILD_LABEL)) {
        issues.push(issue('missingFrontendBuildCommand', '$.frontend', 'Frontend section must give the build command.'));
    }
    if (!readField(section, DEV_LABEL)) {
        issues.push(issue('missingFrontendDevCommand', '$.frontend', 'Frontend section must give the dev command.'));
    }
    if (!readField(section, /seam/i) && !/src\/api\/index\.[jt]sx?/i.test(section)) {
        issues.push(issue('missingApiSeam', '$.frontend', 'Frontend section must name the API seam file to repoint at live data.'));
    }
    if (!/\bmock/i.test(section)) {
        issues.push(issue('missingMockCleanup', '$.frontend', 'Frontend section must name the mock files the integrate agent must delete.'));
    }
}

/** "Shared types: the shared package/location and import alias." */
function validateSharedTypes(section: string | undefined, issues: ArtifactValidationIssue[]): void {
    if (section === undefined || !/`[^`\n]+`/.test(section)) {
        issues.push(issue('missingSharedTypes', '$.sharedTypes', 'Integration plan must name the shared types package and import alias.'));
    }
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}
