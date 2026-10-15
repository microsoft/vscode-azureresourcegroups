/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    findKeyValue,
    findSection,
    findTable,
    parseScaffoldPlanMarkdown,
} from '../../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown.ts';
import { WORKLOAD_QUESTION_CONTRACT } from '../../../src/webviews/copilotOnRails/views/utils/parseRequirements.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';
import { NON_VISUAL_APP_TYPES } from './plannedProject.ts';

const requiredSections = [
    'project overview',
    'services required',
    'quality attributes',
    'prerequisites',
    'project structure',
    'route definitions',
    'next steps',
] as const;

const FALSE_WAF_CLAIM = /\b(?:(?:WAF|Well[- ]Architected)\s+(?:compliant|certified|100%\s+aligned)|100%\s+(?:WAF|Well[- ]Architected)\s+aligned)\b/i;

export function validateProjectPlanArtifact(
    content: string,
    options: { expectedStatus?: string } = {},
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];
    const plan = parseScaffoldPlanMarkdown(content);
    if (plan.parseError) {
        issues.push(issue('productionParserFailure', '$', plan.parseError.message));
    }

    requireMetadata(content, 'Status', issues);
    requireMetadata(content, 'Created', issues);
    requireMetadata(content, 'Mode', issues);
    if (options.expectedStatus) {
        const status = readMetadata(content, 'Status');
        if (status?.toLowerCase() !== options.expectedStatus.toLowerCase()) {
            issues.push(issue('unexpectedStatus', '$.Status', `Expected status "${options.expectedStatus}", found "${status ?? 'missing'}".`));
        }
    }

    const headings = [...content.matchAll(/^##\s+(.+)$/gm)];
    let expectedNumber = 1;
    for (const heading of headings) {
        const match = /^(\d+)\.\s+\S/.exec(heading[1]);
        if (!match) {
            issues.push(issue('unnumberedHeading', '$', `Heading "${heading[1]}" is not numbered.`));
            continue;
        }
        const actual = Number(match[1]);
        if (actual !== expectedNumber) {
            issues.push(issue('nonSequentialHeading', '$', `Expected section ${expectedNumber}, found ${actual}.`));
        }
        expectedNumber = actual + 1;
    }
    if (headings.length === 0) {
        issues.push(issue('missingHeadings', '$', 'Project plan contains no level-two sections.'));
    }

    for (const sectionName of requiredSections) {
        if (!findSection(plan, sectionName)) {
            issues.push(issue('missingSection', '$', `Missing required "${sectionName}" section.`));
        }
    }
    const projectOverview = findSection(plan, 'project overview');
    const appType = projectOverview && findKeyValue(projectOverview, 'App Type');
    const designSystem = findSection(plan, 'design system');
    const hasNonVisualAppType = !!appType && NON_VISUAL_APP_TYPES.includes(appType.toLowerCase());
    const requiresDesignSystem = !hasNonVisualAppType;
    if (requiresDesignSystem && !designSystem) {
        issues.push(issue('missingSection', '$', 'Missing required "design system" section.'));
    }
    if (hasNonVisualAppType && designSystem) {
        issues.push(issue('unexpectedDesignSystem', '$.designSystem', `App Type "${appType}" must not include a Design System section.`));
    }
    if (designSystem && !findKeyValue(designSystem, 'Component Library')) {
        issues.push(issue('missingComponentLibrary', '$.designSystem', 'Design System section must specify Component Library.'));
    }
    validateQualityAttributes(plan, issues);
    if (/```mermaid/i.test(content)) {
        issues.push(issue('forbiddenMermaid', '$', 'Project plan must use the parsed template, not a Mermaid diagram.'));
    }
    if (FALSE_WAF_CLAIM.test(content)) {
        issues.push(issue('falseWellArchitectedClaim', '$.qualityAttributes', 'The plan may record review evidence and risks, but must not claim WAF compliance or certification.'));
    }

    if (content.trimStart().startsWith('---')) {
        issues.push(issue('forbiddenFrontMatter', '$', 'Project plan must not start with YAML front-matter.'));
    }
    validateRouteDefinitions(content, issues);
    return createValidationResult(issues);
}

const QUALITY_ATTRIBUTE_VALUES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
    Object.values(WORKLOAD_QUESTION_CONTRACT).map(contract => [contract.planKey, contract.options]),
);

const WAF_PILLARS = [
    'Reliability',
    'Security',
    'Cost Optimization',
    'Operational Excellence',
    'Performance Efficiency',
] as const;

function validateQualityAttributes(
    plan: ReturnType<typeof parseScaffoldPlanMarkdown>,
    issues: ArtifactValidationIssue[],
): void {
    const section = findSection(plan, 'quality attributes');
    if (!section) {
        return;
    }

    for (const [key, allowed] of Object.entries(QUALITY_ATTRIBUTE_VALUES)) {
        const value = findKeyValue(section, key);
        if (!value) {
            issues.push(issue('missingQualityAttribute', `$.qualityAttributes.${key}`, `Quality Attributes section must specify ${key}.`));
        } else if (!(allowed as readonly string[]).includes(value)) {
            issues.push(issue('invalidQualityAttribute', `$.qualityAttributes.${key}`, `${key} must be one of: ${allowed.join(', ')}.`));
        }
    }

    const table = findTable(section, ['Pillar', 'Workload Target', 'Scaffold Response', 'Planned Validation', 'Deferred Risk']);
    if (!table) {
        issues.push(issue('missingQualityTradeoffTable', '$.qualityAttributes', 'Quality Attributes section must contain the five-column pillar tradeoff table.'));
        return;
    }

    for (const pillar of WAF_PILLARS) {
        const row = table.rows.find(value => value[0]?.trim().toLowerCase() === pillar.toLowerCase());
        if (!row) {
            issues.push(issue('missingQualityPillar', '$.qualityAttributes', `Quality Attributes table is missing the ${pillar} pillar.`));
            continue;
        }
        if (row.slice(1, 5).some(value => !value || /^[-–—]$/.test(value.trim()))) {
            issues.push(issue('incompleteQualityPillar', '$.qualityAttributes', `${pillar} must record a target, scaffold response, planned validation, and deferred risk.`));
        }
    }
}

/**
 * The route table is what the scaffold agent builds against, so it must carry the
 * Method/Path columns and the health endpoint every generated service exposes.
 */
function validateRouteDefinitions(content: string, issues: ArtifactValidationIssue[]): void {
    const lines = content.split('\n');
    const start = lines.findIndex(line => /^##\s+\d+\.\s+Route Definitions/i.test(line));
    if (start === -1) {
        return;
    }
    const offset = lines.slice(start + 1).findIndex(line => /^##\s+\d+\./.test(line));
    const body = lines.slice(start, offset === -1 ? undefined : start + 1 + offset).join('\n');
    if (!body.includes('Method') || !body.includes('Path')) {
        issues.push(issue('missingRouteColumns', '$.routeDefinitions', 'Route table must have Method and Path columns.'));
    }
    if (!/\/api\/health/i.test(body)) {
        issues.push(issue('missingHealthRoute', '$.routeDefinitions', 'Route table must include the /api/health endpoint.'));
    }
}

function requireMetadata(content: string, name: string, issues: ArtifactValidationIssue[]): void {
    if (!readMetadata(content, name)) {
        issues.push(issue('missingMetadata', `$.${name}`, `Missing **${name}** metadata row.`));
    }
}

function readMetadata(content: string, name: string): string | undefined {
    const match = new RegExp(`^\\*\\*${name}\\*\\*\\s*:\\s*(.+)$`, 'im').exec(content);
    return match?.[1].trim();
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}
