/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic install links for prerequisite tooling.
 *
 * The planning agents describe *which* tools a project needs, but they must
 * never author install URLs themselves — a link emitted straight from model
 * output into the webview would be a prompt-injection vector. Instead the
 * webview matches each tool's **name** against this hardcoded catalog and
 * renders the link from here. A tool with no match simply shows no link, so a
 * cell can never surface an untrusted URL.
 */
import { AZURE_CLI_TOOL_NAME, AZURE_DEVELOPER_CLI_TOOL_NAME } from './deployPrerequisiteCatalog';

export interface PrerequisiteInstallLink {
    /** Canonical, human-readable tool label. */
    label: string;
    /** Official install/download URL — the only URL ever rendered for the tool. */
    url: string;
}

interface InstallLinkRule {
    /** Matched against the (trimmed) tool-name cell. Order matters: more specific rules first. */
    match: RegExp;
    link: PrerequisiteInstallLink;
}

// Ordered most-specific → least-specific. The first rule whose pattern matches
// the tool name wins, so e.g. "Docker Compose" resolves before "Docker" and the
// Azure Functions extension resolves before the Functions Core Tools CLI.
// `\b` (word boundary) guards short acronyms (az, azd, func, npm, pip, node…) so
// they match as whole tokens, not as substrings of unrelated words like "Azure".
const INSTALL_LINK_RULES: InstallLinkRule[] = [
    // Podman rules come before the Docker rules: a "Podman (Docker-compatible)" runtime name
    // contains "docker", so without these it would resolve to the Docker link. Podman Compose
    // before Podman for the same specific-first reason as Docker Compose before Docker.
    { match: /podman[\s-]?compose/i, link: { label: 'Podman Compose', url: 'https://podman-desktop.io/docs/compose' } },
    { match: /podman/i, link: { label: 'Podman Desktop', url: 'https://podman-desktop.io/downloads' } },
    { match: /docker[\s-]?compose/i, link: { label: 'Docker Compose', url: 'https://docs.docker.com/compose/install/' } },
    { match: /docker/i, link: { label: 'Docker Desktop', url: 'https://www.docker.com/products/docker-desktop/' } },
    { match: /ms-azuretools\.vscode-azurefunctions/i, link: { label: 'Azure Functions extension', url: 'https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurefunctions' } },
    { match: /functions core tools|\bfunc\b/i, link: { label: 'Azure Functions Core Tools', url: 'https://learn.microsoft.com/azure/azure-functions/functions-run-local' } },
    { match: /\bpnpm\b/i, link: { label: 'pnpm', url: 'https://pnpm.io/installation' } },
    { match: /\byarn\b/i, link: { label: 'Yarn', url: 'https://yarnpkg.com/getting-started/install' } },
    { match: /\bnpm\b/i, link: { label: 'npm', url: 'https://nodejs.org' } },
    { match: /\bnode(\.?\s?js)?\b/i, link: { label: 'Node.js', url: 'https://nodejs.org' } },
    { match: /\bpip3?\b/i, link: { label: 'pip', url: 'https://pip.pypa.io/en/stable/installation/' } },
    { match: /python/i, link: { label: 'Python', url: 'https://www.python.org/downloads/' } },
    { match: /\.net|dotnet/i, link: { label: '.NET SDK', url: 'https://dotnet.microsoft.com/download' } },
    { match: /chrom(e|ium)/i, link: { label: 'Google Chrome', url: 'https://www.google.com/chrome/' } },
    { match: /edge/i, link: { label: 'Microsoft Edge', url: 'https://www.microsoft.com/edge' } },
    { match: /azure developer cli|\bazd\b/i, link: { label: AZURE_DEVELOPER_CLI_TOOL_NAME, url: 'https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd' } },
    { match: /azure cli|\baz\b/i, link: { label: AZURE_CLI_TOOL_NAME, url: 'https://learn.microsoft.com/cli/azure/install-azure-cli' } },
];

/**
 * Resolves the deterministic install link for a prerequisite tool name, or
 * `undefined` when the name matches no known tool. The returned URL is always
 * from the hardcoded catalog above — never from caller-supplied markdown.
 */
export function getPrerequisiteInstallLink(toolName: string): PrerequisiteInstallLink | undefined {
    const name = toolName.trim();
    if (!name) {
        return undefined;
    }
    for (const rule of INSTALL_LINK_RULES) {
        if (rule.match.test(name)) {
            return rule.link;
        }
    }
    return undefined;
}
