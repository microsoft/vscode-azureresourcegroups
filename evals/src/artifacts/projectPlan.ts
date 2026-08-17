/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    findKeyValue,
    findSection,
    parseScaffoldPlanMarkdown,
} from '../../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import {
    ArtifactValidationIssue,
    ArtifactValidationResult,
    createValidationResult,
} from './validationTypes';

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
    return createValidationResult(issues);
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
