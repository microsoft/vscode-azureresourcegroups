/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import {
    ArtifactValidationIssue,
    ArtifactValidationResult,
    createValidationResult,
} from './validationTypes';

const ignoredDirectories = new Set(['.git', '.azure', 'dist', 'node_modules', 'out']);
const sourceExtension = /\.(?:[cm]?[jt]sx?|html|svelte|vue)$/i;
const testFilePattern = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[^/]+|tests?\/|__tests__\/)/i;
const mockImportPattern = /\b(?:from\s+|import\s+|import\s*\()(['"`])[^'"`]*(?:mockClient|previewState|PreviewStateSwitcher|(?:^|\/)mocks?(?:\/|(?=['"`])))[^'"`]*\1/i;
const mockIdentityPattern = /(?:x-mock-user-id|mockUserId|MOCK_USER_ID)/i;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const persistenceSetupPattern = /(?:^|\/)(?:migrations?|seeds?)(?:\/|$)|(?:^|\/)[^/]*seed[^/]*\.[^/]+$/i;

export async function validateIntegrationOutput(
    workspace: string,
    options: { hasFrontend: boolean },
): Promise<ArtifactValidationResult> {
    if (!options.hasFrontend) {
        return createValidationResult([]);
    }

    const issues: ArtifactValidationIssue[] = [];
    const files = await listSourceFiles(workspace);
    const frontendRoots = inferFrontendRoots(files);
    if (!frontendRoots.length) {
        issues.push(issue('frontendSourceMissing', '$', 'Integrated project does not contain frontend source files.'));
    }
    const frontendMockIdentities = new Map<string, string>();
    for (const relativePath of files.filter(file =>
        frontendRoots.some(root => root === '.' || file === root || file.startsWith(`${root}/`)))) {
        if (testFilePattern.test(relativePath)) {
            continue;
        }
        const content = await fs.readFile(path.join(workspace, relativePath), 'utf8');
        if (mockImportPattern.test(content)) {
            issues.push(issue(
                'frontendMockStillImported',
                relativePath,
                'Integrated frontend source must not import mock data or preview-state modules.',
            ));
        }
        if (mockIdentityPattern.test(content)) {
            for (const identity of content.match(uuidPattern) ?? []) {
                frontendMockIdentities.set(identity.toLowerCase(), relativePath);
            }
        }
    }

    if (frontendMockIdentities.size) {
        const persistenceContents = await Promise.all(files
            .filter(file => persistenceSetupPattern.test(file))
            .filter(file => !testFilePattern.test(file))
            .map(file => fs.readFile(path.join(workspace, file), 'utf8')));
        for (const [identity, relativePath] of frontendMockIdentities) {
            if (!persistenceContents.some(content => content.toLowerCase().includes(identity))) {
                issues.push(issue(
                    'mockAuthIdentityUnseeded',
                    relativePath,
                    `Frontend mock identity ${identity} must be provisioned by backend migration or seed source.`,
                ));
            }
        }
    }

    return createValidationResult(issues);
}

function inferFrontendRoots(files: string[]): string[] {
    const roots = new Set<string>();
    for (const file of files) {
        const parts = file.split('/');
        const namedRoot = parts.findIndex(part => ['client', 'frontend', 'ui', 'web'].includes(part.toLowerCase()));
        if (namedRoot >= 0) {
            roots.add(parts.slice(0, namedRoot + 1).join('/'));
            continue;
        }
        if (/\.(?:jsx|tsx|svelte|vue)$/i.test(file) || /(?:^|\/)index\.html$/i.test(file)) {
            const sourceIndex = parts.lastIndexOf('src');
            roots.add(sourceIndex > 0 ? parts.slice(0, sourceIndex).join('/') : '.');
        }
    }
    return [...roots].sort();
}

async function listSourceFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    async function visit(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        await Promise.all(entries.map(async entry => {
            if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
                return;
            }
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolutePath);
            } else if (entry.isFile() && sourceExtension.test(entry.name)) {
                files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
            }
        }));
    }
    await visit(root);
    return files.sort();
}

function issue(code: string, issuePath: string, message: string): ArtifactValidationIssue {
    return { code, path: issuePath, message };
}
