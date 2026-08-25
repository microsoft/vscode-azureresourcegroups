/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    findKeyValue,
    findSection,
    parseScaffoldPlanMarkdown,
} from '../../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

const requiredSections = [
    'project overview',
    'services required',
    'prerequisites',
    'project structure',
    'route definitions',
    'next steps',
] as const;

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
    const hasNonVisualAppType = !!appType && ['api only', 'background worker'].includes(appType.toLowerCase());
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
    if (/```mermaid/i.test(content)) {
        issues.push(issue('forbiddenMermaid', '$', 'Project plan must use the parsed template, not a Mermaid diagram.'));
    }
    if (content.trimStart().startsWith('---')) {
        issues.push(issue('forbiddenFrontMatter', '$', 'Project plan must not start with YAML front-matter.'));
    }
    validateRouteDefinitions(content, issues);
    return createValidationResult(issues);
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
