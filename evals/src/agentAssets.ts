/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const instructionFolders = [
    'azure-debug-generate',
    'azure-debug-plan',
    'azure-project-plan',
    'azure-project-scaffold',
    'azure-project-integrate',
    'shared-references',
] as const;

export async function prepareAgentWorkspace(repoRoot: string, workspace: string): Promise<void> {
    const sourceRoot = path.join(repoRoot, 'resources', 'agents');
    const destinationRoot = path.join(workspace, '.github', 'agents');
    await fs.rm(destinationRoot, { recursive: true, force: true });
    await Promise.all([
        fs.mkdir(destinationRoot, { recursive: true }),
        // The production create flow writes .azure/.pending-create before launching
        // the planning agent, and VS Code's create_file creates nested preview
        // parents automatically. The SDK evaluation create tool does neither.
        fs.mkdir(path.join(workspace, '.azure', '.preview-temp'), { recursive: true }),
    ]);
    for (const folder of instructionFolders) {
        await fs.cp(path.join(sourceRoot, folder), path.join(destinationRoot, folder), {
            recursive: true,
            force: true,
        });
    }
}

export async function loadAgentSystemPrompt(repoRoot: string, agentName: string, additionalSystemMessage?: string): Promise<string> {
    const filePath = path.join(repoRoot, 'resources', 'agents', `${agentName}.agent.md`);
    const body = stripFrontmatter(await fs.readFile(filePath, 'utf8'));
    const runtimePreamble = [
        `You are the "${agentName}" agent for the Azure Copilot-on-Rails workflow.`,
        'This is an automated evaluation in an isolated workspace.',
        'The production webview gates are represented by tools with the same names.',
        'When an instruction says to call one of those tools and stop, call it and end the turn.',
        ...additionalSystemMessage
            ? []
            : ['Do not delegate to sub-agents; this evaluation provides only the workspace file tools needed for the current phase.'],
        `Read detailed instructions under \`.github/agents/${agentName}/\` exactly as the production agent does.`,
        '',
    ].join('\n');
    const runtimeOverride = additionalSystemMessage
        ? `\n\n## Evaluation runtime constraints\n\n${additionalSystemMessage.trim()}`
        : '';
    return `${runtimePreamble}\n${body}${runtimeOverride}`.trim();
}

export async function computeAgentAssetsHash(repoRoot: string): Promise<string> {
    const root = path.join(repoRoot, 'resources', 'agents');
    const files = await listFiles(root);
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(path.relative(root, file));
        hash.update('\0');
        hash.update(await fs.readFile(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function stripFrontmatter(markdown: string): string {
    const normalized = markdown.replace(/^\uFEFF/, '');
    if (!normalized.startsWith('---\n')) {
        return normalized.trim();
    }
    const end = normalized.indexOf('\n---\n', 4);
    return end === -1 ? normalized.trim() : normalized.slice(end + 5).trim();
}

async function listFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files.sort();
}
