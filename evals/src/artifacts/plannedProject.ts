/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The typed model of what `.azure/project-plan.md` *promised*, for the fidelity graders.
 *
 * This is a reader over the production parser, never a second parser. `projectPlan.ts`
 * already validates the plan's shape with `parseScaffoldPlanMarkdown`; this file asks the
 * same parse tree a different question — not "is the plan well-formed" but "what did it
 * commit to building". A second markdown parser for the same document is precisely the
 * drift these evals exist to detect, so every field below is read through the webview
 * parser's own query helpers.
 *
 * Two structural facts about the plan template
 * (`resources/agents/azure-project-plan/plan.md`) drive the model, and both are easy to
 * get backwards:
 *
 * 1. **`## N. Services Required` is the *Azure resources* table, not the app's services.**
 *    Its columns are `Azure Service | Role in App | Environment Variable | Default Value
 *    (Local) | Classification`. Reading it as an inventory of the app's own services
 *    yields nonsense like a service named "PostgreSQL".
 * 2. **The app's services are the per-service stack sections** — `## N. <Service> — <role>`
 *    — one per service, each carrying a `Language` row. The template names that row as the
 *    discriminator the plan webview itself uses to decide whether a section is a stack
 *    card, so this file uses the same test rather than pattern-matching heading text.
 */

import {
    findKeyValue,
    findSection,
    parseScaffoldPlanMarkdown,
    type ScaffoldPlanSection,
    type ScaffoldPlanTableContent,
} from '../../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown.ts';

/**
 * App Types that describe a project with no browser UI.
 *
 * Exported because `projectPlan.ts` and the fidelity graders must agree on it exactly: one
 * deciding that `Background worker` implies no frontend while the other disagrees would
 * make a plan simultaneously valid and unfaithful.
 */
export const NON_VISUAL_APP_TYPES: readonly string[] = ['api only', 'background worker'];

export type PlannedServiceRole = 'backend' | 'frontend' | 'worker' | 'unknown';

export interface PlannedService {
    /** The part of the heading before the em dash, e.g. `Backend` in `Backend — Azure Functions`. */
    name: string;
    /** The full heading text, used verbatim in failure messages so the row is findable in the plan. */
    heading: string;
    role: PlannedServiceRole;
    language?: string;
    runtime?: string;
    framework?: string;
    packageManager?: string;
}

export interface PlannedResource {
    azureService: string;
    roleInApp?: string;
    environmentVariable?: string;
    /** `Default Value (Local)` — the local connection string, and the most reliable family signal. */
    localDefault?: string;
    classification?: string;
}

export interface PlannedProject {
    appType?: string;
    /**
     * Whether the plan's App Type implies a browser UI. `undefined` when App Type is absent,
     * which is a different thing from "no frontend" and must not be collapsed into `false`.
     */
    expectsFrontend?: boolean;
    services: PlannedService[];
    resources: PlannedResource[];
    /**
     * True when a `Services Required` section exists and carries the documented Azure-resource
     * table. False when the section is missing or uses some other shape — in which case
     * `resources` is empty because nothing was recognised, not because nothing was required.
     */
    resourcesTableRecognised: boolean;
}

export function readPlannedProject(planMarkdown: string): PlannedProject {
    const plan = parseScaffoldPlanMarkdown(planMarkdown);

    const overview = findSection(plan, 'project overview');
    const appType = overview && findKeyValue(overview, 'App Type');
    const services = plan.sections.flatMap(section => {
        const service = readServiceSection(section);
        return service ? [service] : [];
    });

    const requiredSection = findSection(plan, 'services required');
    const resourceTable = requiredSection && findResourceTable(requiredSection);

    return {
        appType,
        expectsFrontend: appType === undefined
            ? undefined
            : !NON_VISUAL_APP_TYPES.includes(appType.trim().toLowerCase()),
        services,
        resources: resourceTable ? readResources(resourceTable) : [],
        resourcesTableRecognised: !!resourceTable,
    };
}

/**
 * A section is a service when it carries a `Language` row.
 *
 * The plan template defines that row as what turns a section into a stack card in the plan
 * webview, so it is the plan's own definition of "this section describes a service" rather
 * than a heuristic invented here. Matching on heading text instead would miss every service
 * whose name the agent chose freely — which is all of them beyond the first.
 */
function readServiceSection(section: ScaffoldPlanSection): PlannedService | undefined {
    const table = section.content.find(
        (content): content is ScaffoldPlanTableContent =>
            content.type === 'table' && !!findComponentRow(content, 'Language'),
    );
    if (!table) {
        return undefined;
    }
    const name = section.title.split(/\s+[—–-]\s+/)[0].trim();
    return {
        name,
        heading: section.title,
        role: inferRole(section.title, !!findComponentRow(table, 'Framework')),
        language: findComponentRow(table, 'Language'),
        runtime: findComponentRow(table, 'Runtime'),
        framework: findComponentRow(table, 'Framework'),
        packageManager: findComponentRow(table, 'Package Manager'),
    };
}

/**
 * Read a `| **Key** | Value |` row out of a two-column stack table. `parseTableRow` has
 * already stripped the bold markers, so the comparison is on plain text.
 */
function findComponentRow(table: ScaffoldPlanTableContent, key: string): string | undefined {
    const needle = key.toLowerCase();
    const row = table.rows.find(cells => (cells[0] ?? '').trim().toLowerCase() === needle);
    const value = row?.[1]?.trim();
    return value ? value : undefined;
}

/**
 * Infer a service's role from its heading, falling back to the presence of a `Framework`
 * row. Role rather than name is what the tree can be matched on: an agent may call its
 * backend `API`, `Server` or `Support API`, and all three land in the same place.
 */
function inferRole(heading: string, hasFramework: boolean): PlannedServiceRole {
    const text = heading.toLowerCase();
    if (/\b(front[\s-]?end|web|ui|client|portal|spa|site)\b/.test(text)) {
        return 'frontend';
    }
    if (/\b(worker|job|jobs|background|queue|processor|scheduler|consumer)\b/.test(text)) {
        return 'worker';
    }
    if (/\b(back[\s-]?end|api|server|service|functions?)\b/.test(text)) {
        return 'backend';
    }
    // Only a frontend stack section carries a Framework row in the template.
    return hasFramework ? 'frontend' : 'unknown';
}

function findResourceTable(section: ScaffoldPlanSection): ScaffoldPlanTableContent | undefined {
    return section.content.find(
        (content): content is ScaffoldPlanTableContent =>
            content.type === 'table' && columnIndex(content, 'azure service') >= 0,
    );
}

function readResources(table: ScaffoldPlanTableContent): PlannedResource[] {
    const service = columnIndex(table, 'azure service');
    const role = columnIndex(table, 'role');
    const variable = columnIndex(table, 'environment variable');
    const local = columnIndex(table, 'default value');
    const classification = columnIndex(table, 'classification');

    return table.rows.flatMap(cells => {
        const azureService = cell(cells, service);
        if (!azureService) {
            return [];
        }
        return [{
            azureService,
            roleInApp: cell(cells, role),
            environmentVariable: cell(cells, variable),
            localDefault: cell(cells, local),
            classification: cell(cells, classification),
        }];
    });
}

function columnIndex(table: ScaffoldPlanTableContent, name: string): number {
    return table.headers.findIndex(header => header.toLowerCase().trim().includes(name));
}

/**
 * Read one cell, discarding the template's own `{placeholder}` braces and code ticks so a
 * plan that left a placeholder in place reads as empty rather than as a resource literally
 * named `{Blob Storage}`.
 */
function cell(cells: string[], index: number): string | undefined {
    if (index < 0) {
        return undefined;
    }
    const value = (cells[index] ?? '').trim().replace(/^[{`]+|[}`]+$/g, '').trim();
    return value && value !== '—' && value !== '-' ? value : undefined;
}
