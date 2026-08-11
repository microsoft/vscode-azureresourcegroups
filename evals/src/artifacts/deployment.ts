/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import {
    getDeploymentPlanRenderIssue,
    parseDeploymentPlanMarkdown,
} from '../../../src/webviews/copilotOnRails/views/utils/parseDeploymentPlanMarkdown';
import {
    ArtifactValidationIssue,
    ArtifactValidationResult,
    createValidationResult,
} from './validationTypes';

export interface DeploymentArtifactValidationResult extends ArtifactValidationResult {
    packageCommand: 'azd package';
    serviceNames: string[];
    infrastructure: 'bicep' | 'terraform' | 'missing';
}

export async function validateDeploymentArtifacts(
    workspace: string,
    planContent: string,
): Promise<DeploymentArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];
    const plan = parseDeploymentPlanMarkdown(planContent);
    const renderIssue = getDeploymentPlanRenderIssue(planContent, plan);
    if (renderIssue) {
        addIssue(issues, renderIssue, '$.deploymentPlan', 'Deployment plan is empty or lacks structured architecture and resource sections.');
    }
    if (!plan.location || !plan.resources.rows.length || !plan.workspaceScan.rows.length) {
        addIssue(issues, 'incompleteDeploymentPlan', '$.deploymentPlan', 'Deployment plan requires a location, component inventory, and Azure resource mapping.');
    }

    const azureYamlPath = path.join(workspace, 'azure.yaml');
    const azureYaml = await readRequiredFile(azureYamlPath, '$.azureYaml', issues);
    const serviceNames = azureYaml ? parseServiceNames(azureYaml) : [];
    if (azureYaml && !/^\s*name\s*:\s*\S+/m.test(azureYaml)) {
        addIssue(issues, 'missingAzdName', '$.azureYaml.name', 'azure.yaml requires a project name.');
    }
    if (!serviceNames.length) {
        addIssue(issues, 'missingAzdServices', '$.azureYaml.services', 'azure.yaml requires at least one service.');
    }
    validateHooks(azureYaml, issues);
    await validateServicePaths(workspace, azureYaml, serviceNames, issues);

    const infrastructure = await detectInfrastructure(workspace);
    if (infrastructure === 'missing') {
        addIssue(issues, 'missingInfrastructure', '$.infra', 'Deployment artifacts require Bicep or Terraform infrastructure.');
    }
    await validateSecretHygiene(workspace, issues);

    return {
        ...createValidationResult(issues),
        packageCommand: 'azd package',
        serviceNames,
        infrastructure,
    };
}

function parseServiceNames(content: string): string[] {
    const services = content.match(/(?:^|\n)services\s*:\s*\n((?:[ \t]+.*(?:\n|$))*)/m)?.[1] ?? '';
    const minimumIndent = services
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.match(/^\s*/)?.[0].length ?? 0)
        .reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(minimumIndent)) {
        return [];
    }
    return services
        .split('\n')
        .flatMap(line => {
            const match = line.match(new RegExp(`^\\s{${minimumIndent}}([A-Za-z0-9_-]+)\\s*:\\s*$`));
            return match ? [match[1]] : [];
        });
}

function validateHooks(content: string, issues: ArtifactValidationIssue[]): void {
    for (const match of content.matchAll(/^\s*shell\s*:\s*(\S+)\s*$/gm)) {
        if (!['sh', 'pwsh'].includes(match[1])) {
            addIssue(issues, 'invalidAzdHookShell', '$.azureYaml.hooks', `azd hook shell "${match[1]}" is unsupported; use sh or pwsh.`);
        }
    }
}

async function validateServicePaths(
    workspace: string,
    content: string,
    serviceNames: string[],
    issues: ArtifactValidationIssue[],
): Promise<void> {
    const workspaceRoot = await fs.realpath(workspace);
    for (const serviceName of serviceNames) {
        const block = content.match(new RegExp(`^\\s+${escapeRegex(serviceName)}\\s*:\\s*\\n((?:\\s{4,}.*(?:\\n|$))*)`, 'm'))?.[1] ?? '';
        const project = block.match(/^\s+project\s*:\s*["']?([^"'#\n]+)["']?\s*$/m)?.[1].trim();
        const host = block.match(/^\s+host\s*:\s*(\S+)\s*$/m)?.[1];
        if (!project || !host) {
            addIssue(issues, 'incompleteAzdService', `$.azureYaml.services.${serviceName}`, 'Each azd service requires project and host fields.');
            continue;
        }
        try {
            const projectPath = await fs.realpath(path.resolve(workspace, project));
            const relative = path.relative(workspaceRoot, projectPath);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                addIssue(
                    issues,
                    'azdServicePathOutsideWorkspace',
                    `$.azureYaml.services.${serviceName}.project`,
                    `Service project path "${project}" must stay within the evaluated workspace.`,
                );
            }
        } catch {
            addIssue(issues, 'missingAzdServicePath', `$.azureYaml.services.${serviceName}.project`, `Service project path "${project}" does not exist.`);
        }
    }
}

async function detectInfrastructure(workspace: string): Promise<DeploymentArtifactValidationResult['infrastructure']> {
    if (await exists(path.join(workspace, 'infra', 'main.bicep'))) {
        return 'bicep';
    }
    const terraformFiles = await listFiles(path.join(workspace, 'infra'), file => file.endsWith('.tf'));
    return terraformFiles.length ? 'terraform' : 'missing';
}

async function validateSecretHygiene(workspace: string, issues: ArtifactValidationIssue[]): Promise<void> {
    const candidates = [
        path.join(workspace, 'azure.yaml'),
        ...await listFiles(path.join(workspace, 'infra'), file => /\.(?:bicep|tf|json|ya?ml)$/i.test(file)),
    ];
    const secretPattern = /\b(?:password|clientSecret|accountKey)\b\s*[:=]\s*["']?(?!\$\{|parameters?\(|getSecret\(|@secure\(|<)[A-Za-z0-9+/=_-]{8,}/i;
    for (const file of candidates) {
        const content = await fs.readFile(file, 'utf8');
        if (secretPattern.test(content)) {
            addIssue(issues, 'hardcodedSecret', path.relative(workspace, file), 'Deployment artifacts must not contain hard-coded credentials.');
        }
    }
}

async function readRequiredFile(file: string, issuePath: string, issues: ArtifactValidationIssue[]): Promise<string> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            addIssue(issues, 'missingDeploymentArtifact', issuePath, `${path.basename(file)} is required.`);
            return '';
        }
        throw error;
    }
}

async function listFiles(directory: string, include: (file: string) => boolean): Promise<string[]> {
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const nested = await Promise.all(entries.map(async entry => {
            const file = path.join(directory, entry.name);
            return entry.isDirectory() ? await listFiles(file, include) : include(file) ? [file] : [];
        }));
        return nested.flat();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addIssue(issues: ArtifactValidationIssue[], code: string, issuePath: string, message: string): void {
    issues.push({ code, path: issuePath, message });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const value = (name: string): string | undefined => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
    };
    const workspace = path.resolve(value('--workspace') ?? process.cwd());
    const planPath = path.resolve(value('--plan') ?? path.join(workspace, '.azure', 'deployment-plan.md'));
    const result = await validateDeploymentArtifacts(workspace, await fs.readFile(planPath, 'utf8'));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.valid) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    void main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
