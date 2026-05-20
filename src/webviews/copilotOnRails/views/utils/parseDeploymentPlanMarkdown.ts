/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DeploymentPlanData, type DeploymentPlanTable } from "./deploymentPlanTypes";

/**
 * Parses a deployment plan markdown file into DeploymentPlanData.
 *
 * Expected format:
 *
 * **Status**: Awaiting Approval
 * **Mode**: MODERNIZE — deploy existing full-stack app to Azure
 * **Subscription**: meganmott dev
 * **Location**: East US
 * **LocationCode**: eastus
 *
 * ## Architecture Diagram
 * ```mermaid
 * graph TD
 *     ...
 * ```
 *
 * ## Workspace Scan
 * | Component | Technology | Azure Target |
 * |-----------|------------|--------------|
 * | ...       | ...        | ...          |
 *
 * ## Decisions
 * | Decision | Choice | Rationale |
 * |----------|--------|-----------|
 * | ...      | ...    | ...       |
 *
 * ## Azure Resources
 * | Resource | Name pattern | SKU / Tier |
 * |----------|--------------|------------|
 * | ...      | ...          | ...        |
 */
export function parseDeploymentPlanMarkdown(markdown: string): DeploymentPlanData {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const requirements = extractAttributeValueTable(findSectionByName(extractNamedSections(lines), ['Requirements']));

    const status = extractMetadata(lines, 'Status') ?? 'Unknown';
    const mode = extractMetadata(lines, 'Mode') ?? 'Unknown';
    const subscription = extractMetadata(lines, 'Subscription') ?? requirements['Subscription'] ?? 'Unknown';
    const rawLocation = extractMetadata(lines, 'Location') ?? requirements['Location'] ?? 'Unknown';

    // Parse location: "East US (`eastus`)" → name="East US", code="eastus"
    const locationMatch = rawLocation.match(/^(.+?)\s*\(`?([a-z0-9]+)`?\)\s*$/i);
    const location = locationMatch ? locationMatch[1].trim() : rawLocation;
    const locationCode = locationMatch ? locationMatch[2].trim() : extractMetadata(lines, 'LocationCode') ?? 'unknown';

    const sections = extractNamedSections(lines);

    // Support alternate section headings for compatibility with user-authored plans
    const mermaidDiagram = extractMermaidBlock(findSectionByName(sections, ['Architecture Diagram', 'Architecture']));

    const workspaceScan = extractTable(findSectionByName(sections, ['Workspace Scan', 'Components Detected']));

    const decisions = extractTable(findSectionByName(sections, ['Decisions', 'Recipe Selection']));

    const resources = extractTable(findSectionByName(sections, ['Service Mapping', 'Azure Resources', 'Provisioning Limit Checklist']));

    // Provide placeholder dropdown options when values are unknown
    const availableSubscriptions = subscription === 'Unknown'
        ? ['Visual Studio Enterprise', 'Azure for Students', 'Pay-As-You-Go', 'MSDN Platforms']
        : undefined;

    const availableLocations = locationCode === 'unknown'
        ? [
            { name: 'East US', code: 'eastus' },
            { name: 'East US 2', code: 'eastus2' },
            { name: 'West US', code: 'westus' },
            { name: 'West US 2', code: 'westus2' },
            { name: 'Central US', code: 'centralus' },
            { name: 'North Europe', code: 'northeurope' },
            { name: 'West Europe', code: 'westeurope' },
            { name: 'Southeast Asia', code: 'southeastasia' },
        ]
        : undefined;

    return {
        status,
        mode,
        subscription: subscription === 'Unknown' ? '' : subscription,
        availableSubscriptions,
        location: location === 'Unknown' ? '' : location,
        locationCode: locationCode === 'unknown' ? '' : locationCode,
        availableLocations,
        mermaidDiagram,
        workspaceScan,
        decisions,
        resources,
    };
}

function extractMetadata(lines: string[], key: string): string | undefined {
    for (const line of lines) {
        // Match both **Key**: value and **Key:** value, optionally inside a markdown blockquote.
        const match = line.match(new RegExp(`^>?\\s*\\*\\*${key}:?\\*\\*:?\\s*(.+)$`));
        if (match) {
            return match[1].trim();
        }
    }
    return undefined;
}

function findSectionByName(sections: Record<string, string[]>, names: string[]): string[] {
    const normalized = new Map(Object.entries(sections).map(([name, value]) => [normalizeSectionName(name), value]));
    for (const name of names) {
        const match = normalized.get(normalizeSectionName(name));
        if (match) {
            return match;
        }
    }
    return [];
}

function normalizeSectionName(name: string): string {
    return name.replace(/^\d+\.\s+/, '').trim().toLowerCase();
}

function extractAttributeValueTable(lines: string[]): Record<string, string> {
    const table = extractTable(lines);
    if (table.headers.length < 2) {
        return {};
    }

    const values: Record<string, string> = {};
    for (const row of table.rows) {
        const key = row[0]?.trim();
        const value = row[1]?.trim();
        if (key && value) {
            values[key] = value;
        }
    }
    return values;
}

function extractNamedSections(lines: string[]): Record<string, string[]> {
    const sections: Record<string, string[]> = {};
    let currentH2: string | undefined;
    let currentH3: string | undefined;

    for (const line of lines) {
        const h2Match = line.match(/^##\s+(?:\d+\.\s+)?(.+)$/);
        if (h2Match) {
            currentH2 = h2Match[1].trim();
            currentH3 = undefined;
            sections[currentH2] = [];
            continue;
        }

        const h3Match = line.match(/^###\s+(?:\d+\.\s+)?(.+)$/);
        if (h3Match) {
            currentH3 = h3Match[1].trim();
            sections[currentH3] = [];
            if (currentH2) {
                sections[currentH2].push(line);
            }
            continue;
        }

        if (currentH3) {
            sections[currentH3].push(line);
        }
        if (currentH2) {
            sections[currentH2].push(line);
        }
    }

    return sections;
}

function extractMermaidBlock(lines: string[]): string {
    const diagramLines: string[] = [];
    let inBlock = false;

    for (const line of lines) {
        // Match ```mermaid or plain ``` code blocks
        if (!inBlock && line.trim().match(/^```/)) {
            inBlock = true;
            // Skip the opening fence line itself
            continue;
        }
        if (inBlock && line.trim() === '```') {
            break;
        }
        if (inBlock) {
            diagramLines.push(line);
        }
    }

    // If no fenced code block, use all non-empty lines as the diagram text
    if (diagramLines.length === 0) {
        return lines.filter(l => l.trim().length > 0).join('\n');
    }

    return diagramLines.join('\n');
}

function extractTable(lines: string[]): DeploymentPlanTable {
    const tableLines = lines.filter(l => l.trim().startsWith('|'));

    if (tableLines.length < 2) {
        return { headers: [], rows: [] };
    }

    const headers = parseTableRow(tableLines[0]);

    // Skip separator line
    let dataStart = 1;
    if (tableLines[dataStart]?.trim().match(/^\|[\s\-:|]+\|$/)) {
        dataStart = 2;
    }

    const rows = tableLines.slice(dataStart).map(parseTableRow);

    return { headers, rows };
}

function parseTableRow(line: string): string[] {
    return line
        .split('|')
        .slice(1, -1)
        .map(cell => cell.trim().replace(/\*\*/g, ''));
}
