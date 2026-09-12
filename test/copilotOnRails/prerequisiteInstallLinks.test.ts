/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getPrerequisiteInstallLink } from '../../src/webviews/copilotOnRails/views/utils/prerequisiteInstallLinks';

suite('prerequisiteInstallLinks', () => {
    test('resolves common run tools by name', () => {
        assert.strictEqual(getPrerequisiteInstallLink('Node.js')?.url, 'https://nodejs.org');
        assert.strictEqual(getPrerequisiteInstallLink('node')?.url, 'https://nodejs.org');
        assert.strictEqual(getPrerequisiteInstallLink('npm')?.url, 'https://nodejs.org');
        assert.strictEqual(getPrerequisiteInstallLink('pnpm')?.url, 'https://pnpm.io/installation');
        assert.strictEqual(getPrerequisiteInstallLink('yarn')?.url, 'https://yarnpkg.com/getting-started/install');
        assert.strictEqual(getPrerequisiteInstallLink('Python')?.url, 'https://www.python.org/downloads/');
        assert.strictEqual(getPrerequisiteInstallLink('pip')?.url, 'https://pip.pypa.io/en/stable/installation/');
        assert.strictEqual(getPrerequisiteInstallLink('.NET SDK')?.url, 'https://dotnet.microsoft.com/download');
    });

    test('resolves Docker Compose before Docker', () => {
        assert.strictEqual(getPrerequisiteInstallLink('Docker Compose')?.url, 'https://docs.docker.com/compose/install/');
        assert.strictEqual(getPrerequisiteInstallLink('docker-compose')?.url, 'https://docs.docker.com/compose/install/');
        assert.strictEqual(getPrerequisiteInstallLink('Docker')?.url, 'https://www.docker.com/products/docker-desktop/');
    });

    test('resolves Podman Compose before Podman', () => {
        assert.strictEqual(getPrerequisiteInstallLink('Podman Compose')?.url, 'https://podman-desktop.io/docs/compose');
        assert.strictEqual(getPrerequisiteInstallLink('podman-compose')?.url, 'https://podman-desktop.io/docs/compose');
        assert.strictEqual(getPrerequisiteInstallLink('Podman')?.url, 'https://podman-desktop.io/downloads');
    });

    test('resolves Podman (Docker-compatible) to Podman, not Docker', () => {
        // The docker-compat runtime label embeds "docker", so the Podman rules must win.
        assert.strictEqual(getPrerequisiteInstallLink('Podman (Docker-compatible)')?.url, 'https://podman-desktop.io/downloads');
    });

    test('resolves the Azure Functions extension before the Core Tools CLI', () => {
        assert.strictEqual(
            getPrerequisiteInstallLink('`ms-azuretools.vscode-azurefunctions`')?.url,
            'https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurefunctions',
        );
        assert.strictEqual(
            getPrerequisiteInstallLink('Azure Functions Core Tools')?.url,
            'https://learn.microsoft.com/azure/azure-functions/functions-run-local',
        );
        assert.strictEqual(
            getPrerequisiteInstallLink('func')?.url,
            'https://learn.microsoft.com/azure/azure-functions/functions-run-local',
        );
    });

    test('resolves browsers', () => {
        assert.strictEqual(getPrerequisiteInstallLink('Chrome')?.url, 'https://www.google.com/chrome/');
        assert.strictEqual(getPrerequisiteInstallLink('Microsoft Edge')?.url, 'https://www.microsoft.com/edge');
    });

    test('resolves deploy CLIs, distinguishing azd from az', () => {
        assert.strictEqual(
            getPrerequisiteInstallLink('Azure Developer CLI (azd)')?.url,
            'https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd',
        );
        assert.strictEqual(
            getPrerequisiteInstallLink('azd')?.url,
            'https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd',
        );
        assert.strictEqual(
            getPrerequisiteInstallLink('Azure CLI (az)')?.url,
            'https://learn.microsoft.com/cli/azure/install-azure-cli',
        );
        assert.strictEqual(
            getPrerequisiteInstallLink('az')?.url,
            'https://learn.microsoft.com/cli/azure/install-azure-cli',
        );
    });

    test('returns undefined for unknown or empty tool names', () => {
        assert.strictEqual(getPrerequisiteInstallLink(''), undefined);
        assert.strictEqual(getPrerequisiteInstallLink('   '), undefined);
        assert.strictEqual(getPrerequisiteInstallLink('SomeUnknownTool'), undefined);
    });

    test('never returns a URL sourced from the input, only the catalog', () => {
        // Even if a tool name embeds a URL, the resolver ignores it and returns a
        // catalog URL (or undefined) — the input URL must never surface.
        const link = getPrerequisiteInstallLink('Node.js https://evil.example.com');
        assert.strictEqual(link?.url, 'https://nodejs.org');
    });
});
