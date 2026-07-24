/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DeploymentPlanData, type DeploymentPlanTable } from "./deploymentPlanTypes";

const DEPLOYMENT_SECTION_ALIASES = {
    requirements: ['Requirements', 'Confirmed Requirements', 'Requirements and Constraints'],
    architecture: ['Architecture Diagram', 'Architecture', 'Azure Architecture', 'Proposed Azure Architecture', 'Target Architecture', 'Architecture Design'],
    workspaceScan: ['Workspace Scan', 'Components Detected', 'Components', 'Application Analysis', 'Workspace Analysis'],
    decisions: ['Decisions', 'Recipe Selection', 'Architecture Decisions', 'Key Decisions'],
    resourceSections: ['Azure Resources', 'Resources to Create', 'Azure Services', 'Infrastructure Components', 'Services and Configuration', 'Provisioning Limit Checklist'],
    resourceSubsections: ['Service Mapping', 'Resource Inventory & Quota Validation'],
} as const;

interface MarkdownSubsection {
    heading: string;
    lines: string[];
}

interface MarkdownSection {
    heading: string;
    lines: string[];
    subsections: MarkdownSubsection[];
}

interface TableCandidate {
    heading: string;
    parentHeading?: string;
    table: DeploymentPlanTable;
}

export type DeploymentPlanRenderIssue = 'empty' | 'missingStructuredSections';

/**
 * Parses the generated deployment plan into the structured data rendered by the
 * deployment plan view. Heading aliases cover known templates while table-header
 * classification tolerates reasonable generated variations.
 */
export function parseDeploymentPlanMarkdown(markdown: string): DeploymentPlanData {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const sections = extractSections(lines);
    const tableCandidates = extractTableCandidates(sections);
    const requirements = extractAttributeValueTable(findSection(sections, DEPLOYMENT_SECTION_ALIASES.requirements));

    const status = extractMetadata(lines, 'Status') ?? 'Unknown';
    const mode = extractMetadata(lines, 'Mode') ?? 'Unknown';
    const subscription = extractMetadata(lines, 'Subscription') ?? findAttribute(requirements, 'Subscription') ?? 'Unknown';
    const rawLocation = extractMetadata(lines, 'Location') ?? findAttribute(requirements, 'Location') ?? 'Unknown';

    // Parse location: "East US (`eastus`)" -> name="East US", code="eastus"
    const locationMatch = rawLocation.match(/^(.+?)\s*\(`?([a-z0-9]+)`?\)\s*$/i);
    const location = locationMatch ? locationMatch[1].trim() : rawLocation;
    const locationCode = locationMatch ? locationMatch[2].trim() : extractMetadata(lines, 'LocationCode') ?? 'unknown';

    const workspaceCandidate = findTableCandidate(
        tableCandidates,
        DEPLOYMENT_SECTION_ALIASES.workspaceScan,
        isWorkspaceTable,
    );
    const decisionsCandidate = findTableCandidate(
        tableCandidates,
        DEPLOYMENT_SECTION_ALIASES.decisions,
        isDecisionsTable,
    );
    const resourcesCandidate = findResourceTableCandidate(tableCandidates);
    const architecture = extractArchitectureTables(
        findSection(sections, DEPLOYMENT_SECTION_ALIASES.architecture),
        resourcesCandidate,
    );

    const availableSubscriptions = subscription === 'Unknown'
        ? ['Visual Studio Enterprise', 'Azure for Students', 'Pay-As-You-Go', 'MSDN Platforms']
        : undefined;

    const knownLocations = [
        { name: 'East US', code: 'eastus' },
        { name: 'East US 2', code: 'eastus2' },
        { name: 'West US', code: 'westus' },
        { name: 'West US 2', code: 'westus2' },
        { name: 'Central US', code: 'centralus' },
        { name: 'North Europe', code: 'northeurope' },
        { name: 'West Europe', code: 'westeurope' },
        { name: 'Southeast Asia', code: 'southeastasia' },
    ];

    let resolvedLocationCode = locationCode;
    let resolvedLocation = location;
    if (resolvedLocationCode === 'unknown' && location !== 'Unknown') {
        const needle = location.toLowerCase();
        const matched = knownLocations.find(l => l.name.toLowerCase() === needle || l.code.toLowerCase() === needle);
        if (matched) {
            resolvedLocationCode = matched.code;
            resolvedLocation = matched.name;
        }
    }

    return {
        status,
        mode,
        subscription: subscription === 'Unknown' ? '' : subscription,
        availableSubscriptions,
        location: resolvedLocation === 'Unknown' ? '' : resolvedLocation,
        locationCode: resolvedLocationCode === 'unknown' ? '' : resolvedLocationCode,
        availableLocations: knownLocations,
        architecture,
        workspaceScan: workspaceCandidate?.table ?? emptyTable(),
        decisions: decisionsCandidate?.table ?? emptyTable(),
        resources: resourcesCandidate?.table ?? emptyTable(),
        resourcesHeading: resourcesCandidate?.heading,
    };
}

export function getDeploymentPlanRenderIssue(markdown: string, plan: DeploymentPlanData): DeploymentPlanRenderIssue | undefined {
    if (markdown.trim().length === 0) {
        return 'empty';
    }

    if (plan.resources.rows.length === 0
        && plan.decisions.rows.length === 0
        && plan.workspaceScan.rows.length === 0
        && plan.architecture.length === 0) {
        return 'missingStructuredSections';
    }

    return undefined;
}

function extractMetadata(lines: string[], key: string): string | undefined {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedKey}\\s*:\\s*(.+)$`, 'i');

    for (const line of lines) {
        const normalized = line
            .replace(/^\s*>\s*/, '')
            .replace(/^\s*#{1,6}\s+/, '')
            .replace(/^\s*[-*]\s+/, '')
            .replace(/\*\*/g, '')
            .trim();
        const match = normalized.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }
    return undefined;
}

function extractSections(lines: string[]): MarkdownSection[] {
    const sections: MarkdownSection[] = [];
    let currentSection: MarkdownSection | undefined;
    let currentSubsection: MarkdownSubsection | undefined;

    for (const line of lines) {
        const h2Match = line.match(/^##\s+(.+)$/);
        if (h2Match) {
            currentSection = {
                heading: cleanSectionHeading(h2Match[1]),
                lines: [],
                subsections: [],
            };
            sections.push(currentSection);
            currentSubsection = undefined;
            continue;
        }

        const h3Match = line.match(/^###\s+(.+)$/);
        if (h3Match && currentSection) {
            currentSubsection = {
                heading: cleanSectionHeading(h3Match[1]),
                lines: [],
            };
            currentSection.subsections.push(currentSubsection);
            continue;
        }

        if (currentSubsection) {
            currentSubsection.lines.push(line);
        } else if (currentSection) {
            currentSection.lines.push(line);
        }
    }

    return sections;
}

function extractTableCandidates(sections: MarkdownSection[]): TableCandidate[] {
    const candidates: TableCandidate[] = [];

    for (const section of sections) {
        for (const table of extractTables(section.lines)) {
            candidates.push({ heading: section.heading, table });
        }
        for (const subsection of section.subsections) {
            for (const table of extractTables(subsection.lines)) {
                candidates.push({
                    heading: subsection.heading,
                    parentHeading: section.heading,
                    table,
                });
            }
        }
    }

    return candidates;
}

function findSection(sections: MarkdownSection[], names: readonly string[]): MarkdownSection | undefined {
    return sections.find(section => headingMatches(section.heading, names));
}

function findTableCandidate(
    candidates: TableCandidate[],
    headingAliases: readonly string[],
    semanticMatch: (table: DeploymentPlanTable) => boolean,
): TableCandidate | undefined {
    return candidates.find(candidate =>
        headingMatches(candidate.heading, headingAliases)
        && semanticMatch(candidate.table)
    )
        ?? candidates.find(candidate => headingMatches(candidate.heading, headingAliases))
        ?? candidates.find(candidate => semanticMatch(candidate.table));
}

function findResourceTableCandidate(candidates: TableCandidate[]): TableCandidate | undefined {
    const prioritizedHeadings = [
        ...DEPLOYMENT_SECTION_ALIASES.resourceSubsections,
        ...DEPLOYMENT_SECTION_ALIASES.resourceSections,
    ];
    for (const heading of prioritizedHeadings) {
        const candidate = candidates.find(item =>
            headingMatches(item.heading, [heading])
            && isResourceTable(item.table)
        );
        if (candidate) {
            return candidate;
        }
    }
    return candidates.find(candidate => isResourceTable(candidate.table));
}

function extractArchitectureTables(
    section: MarkdownSection | undefined,
    resourcesCandidate: TableCandidate | undefined,
): { title?: string; table: DeploymentPlanTable }[] {
    if (!section) {
        return [];
    }

    const architecture: { title?: string; table: DeploymentPlanTable }[] = [];
    for (const table of extractTables(section.lines)) {
        if (!isSameTableCandidate(section.heading, undefined, table, resourcesCandidate)) {
            architecture.push({ table });
        }
    }
    for (const subsection of section.subsections) {
        for (const table of extractTables(subsection.lines)) {
            if (!isSameTableCandidate(subsection.heading, section.heading, table, resourcesCandidate)) {
                architecture.push({ title: subsection.heading, table });
            }
        }
    }
    return architecture;
}

function isSameTableCandidate(
    heading: string,
    parentHeading: string | undefined,
    table: DeploymentPlanTable,
    candidate: TableCandidate | undefined,
): boolean {
    return candidate !== undefined
        && normalizeHeading(candidate.heading) === normalizeHeading(heading)
        && normalizeHeading(candidate.parentHeading ?? '') === normalizeHeading(parentHeading ?? '')
        && JSON.stringify(candidate.table) === JSON.stringify(table);
}

function extractAttributeValueTable(section: MarkdownSection | undefined): DeploymentPlanTable {
    return section ? extractTables(section.lines)[0] ?? emptyTable() : emptyTable();
}

function findAttribute(table: DeploymentPlanTable, attribute: string): string | undefined {
    const normalizedAttribute = normalizeHeader(attribute);
    const row = table.rows.find(candidate => normalizeHeader(candidate[0] ?? '') === normalizedAttribute);
    return row?.[1]?.trim();
}

function isWorkspaceTable(table: DeploymentPlanTable): boolean {
    const headers = normalizedHeaders(table);
    return headers.includes('component')
        && headers.some(header => ['technology', 'type', 'path', 'framework', 'language'].includes(header));
}

function isDecisionsTable(table: DeploymentPlanTable): boolean {
    const headers = normalizedHeaders(table);
    return headers.includes('decision')
        && headers.some(header => ['choice', 'rationale', 'reason'].includes(header));
}

function isResourceTable(table: DeploymentPlanTable): boolean {
    const headers = normalizedHeaders(table);
    const hasResourceIdentity = headers.some(header =>
        ['resource', 'resource type', 'azure resource', 'azure service', 'service'].includes(header)
    );
    const hasResourceConfiguration = headers.some(header =>
        header.includes('sku')
        || ['tier', 'config', 'configuration', 'purpose', 'number to deploy', 'count'].includes(header)
    );
    return hasResourceIdentity && hasResourceConfiguration;
}

function normalizedHeaders(table: DeploymentPlanTable): string[] {
    return table.headers.map(normalizeHeader);
}

function normalizeHeader(header: string): string {
    return header
        .replace(/[`*_]/g, '')
        .replace(/\s*\/\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function headingMatches(heading: string, aliases: readonly string[]): boolean {
    const normalizedHeading = normalizeHeading(heading);
    return aliases.some(alias => normalizeHeading(alias) === normalizedHeading);
}

function normalizeHeading(heading: string): string {
    return stripSectionNumber(heading)
        .replace(/[`*_]/g, '')
        .replace(/(?:✅|⚠️|❌|⛔)/gu, '')
        .trim()
        .toLowerCase();
}

function stripSectionNumber(heading: string): string {
    return heading.replace(/^\d+(?:\.\d+)*[.)]?\s+/, '').trim();
}

function cleanSectionHeading(heading: string): string {
    return stripSectionNumber(heading).replace(/[`*_]/g, '').trim();
}

function extractTables(lines: string[]): DeploymentPlanTable[] {
    const tables: DeploymentPlanTable[] = [];

    for (let index = 0; index < lines.length - 1; index++) {
        if (!isTableRow(lines[index]) || !isTableSeparator(lines[index + 1])) {
            continue;
        }

        const tableLines = [lines[index], lines[index + 1]];
        index += 2;
        while (index < lines.length && isTableRow(lines[index])) {
            tableLines.push(lines[index]);
            index++;
        }
        index--;

        tables.push({
            headers: parseTableRow(tableLines[0]),
            rows: tableLines.slice(2).map(parseTableRow),
        });
    }

    return tables;
}

function isTableRow(line: string): boolean {
    return line.trim().includes('|');
}

function isTableSeparator(line: string): boolean {
    const cells = parseTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim().replace(/\*\*/g, ''));
}

function emptyTable(): DeploymentPlanTable {
    return { headers: [], rows: [] };
}
