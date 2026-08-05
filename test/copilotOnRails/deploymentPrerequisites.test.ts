/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Uri } from 'vscode';
import {
    deploySkillNames,
    deploySkillVersionTelemetryKey,
    parseSkillMetadataVersion,
    readWorkspaceSkillVersion,
    skillExistsInRoots,
    unknownSkillVersion,
} from '../../src/commands/copilotOnRails/deploymentPrerequisites';

/** Canonical `azure-prepare` frontmatter shape (double-quoted metadata.version). */
const azurePrepareSkillMd = `---
name: azure-prepare
description: "Prepare azd-based Azure projects for deployment."
license: MIT
metadata:
  author: Microsoft
  version: "1.3.1"
---

# Azure Prepare
`;

function writeSkillMarkdown(agentsRoot: string, skillName: string, content: string): void {
    const dir = path.join(agentsRoot, 'skills', skillName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

suite('deploymentPrerequisites', () => {
    suite('deploySkillNames', () => {
        test('records exactly the three deploy skills', () => {
            assert.deepStrictEqual([...deploySkillNames], ['azure-prepare', 'azure-validate', 'azure-deploy']);
        });
    });

    suite('deploySkillVersionTelemetryKey', () => {
        test('maps kebab-case skill names to camelCase version keys', () => {
            assert.strictEqual(deploySkillVersionTelemetryKey('azure-prepare'), 'azurePrepareSkillVersion');
            assert.strictEqual(deploySkillVersionTelemetryKey('azure-validate'), 'azureValidateSkillVersion');
            assert.strictEqual(deploySkillVersionTelemetryKey('azure-deploy'), 'azureDeploySkillVersion');
        });
    });

    suite('parseSkillMetadataVersion', () => {
        test('parses the canonical azure-prepare metadata.version', () => {
            assert.strictEqual(parseSkillMetadataVersion(azurePrepareSkillMd), '1.3.1');
        });

        test('parses a single-quoted version', () => {
            const content = `---\nname: azure-validate\nmetadata:\n  version: '2.0.0'\n---\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), '2.0.0');
        });

        test('parses an unquoted version', () => {
            const content = `---\nname: azure-deploy\nmetadata:\n  author: Microsoft\n  version: 0.9.7\n---\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), '0.9.7');
        });

        test('tolerates CRLF line endings and a leading BOM', () => {
            const content = `\uFEFF---\r\nname: azure-prepare\r\nmetadata:\r\n  version: "3.2.1"\r\n---\r\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), '3.2.1');
        });

        test('returns undefined when there is no frontmatter', () => {
            assert.strictEqual(parseSkillMetadataVersion('# Azure Prepare\n\nNo frontmatter here.'), undefined);
        });

        test('returns undefined when the metadata block has no version (missing-version fallback)', () => {
            const content = `---\nname: azure-prepare\nmetadata:\n  author: Microsoft\n---\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), undefined);
        });

        test('returns undefined when the version value is empty', () => {
            const content = `---\nname: azure-prepare\nmetadata:\n  version: ""\n---\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), undefined);
        });

        test('ignores a top-level version outside the metadata block', () => {
            const content = `---\nname: azure-prepare\nversion: 9.9.9\nmetadata:\n  author: Microsoft\n---\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), undefined);
        });

        test('does not confuse a top-level version with the metadata.version', () => {
            const content = `---\nversion: 9.9.9\nmetadata:\n  version: "1.0.0"\n---\n`;
            assert.strictEqual(parseSkillMetadataVersion(content), '1.0.0');
        });
    });

    suite('workspace skill detection and version reading', () => {
        let tempDir: string;

        setup(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cor-deploy-skills-'));
        });

        teardown(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        test('skillExistsInRoots is false when the workspace copy is missing (global copy does not count)', async () => {
            const globalRoot = path.join(tempDir, 'global', '.agents');
            const workspaceRoot = path.join(tempDir, 'workspace', '.agents');
            // Only the global-like root has the skill; the workspace root does not.
            writeSkillMarkdown(globalRoot, 'azure-prepare', azurePrepareSkillMd);

            const existsInWorkspace = await skillExistsInRoots([Uri.file(workspaceRoot)], 'azure-prepare');
            assert.strictEqual(existsInWorkspace, false, 'a global copy must not satisfy the workspace-only check');
        });

        test('skillExistsInRoots is true when the workspace copy is present', async () => {
            const workspaceRoot = path.join(tempDir, 'workspace', '.agents');
            writeSkillMarkdown(workspaceRoot, 'azure-prepare', azurePrepareSkillMd);

            const existsInWorkspace = await skillExistsInRoots([Uri.file(workspaceRoot)], 'azure-prepare');
            assert.strictEqual(existsInWorkspace, true);
        });

        test('readWorkspaceSkillVersion resolves the semver from a workspace SKILL.md', async () => {
            const workspaceRoot = path.join(tempDir, '.agents');
            writeSkillMarkdown(workspaceRoot, 'azure-prepare', azurePrepareSkillMd);

            const version = await readWorkspaceSkillVersion([Uri.file(workspaceRoot)], 'azure-prepare');
            assert.strictEqual(version, '1.3.1');
        });

        test('readWorkspaceSkillVersion returns undefined when the skill is not installed in the workspace', async () => {
            const workspaceRoot = path.join(tempDir, '.agents');
            const version = await readWorkspaceSkillVersion([Uri.file(workspaceRoot)], 'azure-validate');
            assert.strictEqual(version, undefined);
        });

        test('readWorkspaceSkillVersion returns undefined when SKILL.md lacks a metadata.version', async () => {
            const workspaceRoot = path.join(tempDir, '.agents');
            writeSkillMarkdown(workspaceRoot, 'azure-deploy', `---\nname: azure-deploy\nmetadata:\n  author: Microsoft\n---\n`);

            const version = await readWorkspaceSkillVersion([Uri.file(workspaceRoot)], 'azure-deploy');
            assert.strictEqual(version, undefined);
        });

        test('a missing version falls back to the unknown sentinel', async () => {
            const workspaceRoot = path.join(tempDir, '.agents');
            const version = await readWorkspaceSkillVersion([Uri.file(workspaceRoot)], 'azure-deploy');
            assert.strictEqual(version ?? unknownSkillVersion, unknownSkillVersion);
        });
    });
});
