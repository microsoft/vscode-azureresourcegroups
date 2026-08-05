/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type CliPrerequisite, type CliPrerequisiteStatus } from '../../webviews/copilotOnRails/views/utils/deploymentPlanTypes';
import { isUpdateRecommended, parseAzdVersion, parseAzVersion, statusForVersion } from './cliVersionUtils';

const execFileAsync = promisify(execFile);

/** Identifiers for the deploy CLIs we detect. */
export type CliId = 'azd' | 'az';

/** Value recorded in telemetry when a version couldn't be confirmed. */
export const UNKNOWN_CLI_VERSION = '';

const CLI_SHELL_TIMEOUT_MS = 8_000;
const LATEST_STABLE_TIMEOUT_MS = 5_000;

interface CliDefinition {
    id: CliId;
    name: string;
    /** Builds the CLI version string from stdout, or `undefined` when unconfirmable. */
    parseVersion: (stdout: string) => string | undefined;
    versionArgs: string[];
    /** Fetches the latest stable version from the tool's release feed. */
    getLatestStable: () => Promise<string | undefined>;
    intro: string;
    upgradeIntro: string;
    commands: string[];
    docsUrl: string;
}

const CLI_DEFINITIONS: Record<CliId, CliDefinition> = {
    azd: {
        id: 'azd',
        name: 'Azure Developer CLI (azd)',
        parseVersion: parseAzdVersion,
        versionArgs: ['version'],
        getLatestStable: getLatestAzdStable,
        intro: 'Install the Azure Developer CLI:',
        upgradeIntro: 'Update the Azure Developer CLI:',
        commands: [
            'winget install microsoft.azd',
            'brew tap azure/azd && brew install azd',
            'curl -fsSL https://aka.ms/install-azd.sh | bash',
        ],
        docsUrl: 'https://aka.ms/azd-install',
    },
    az: {
        id: 'az',
        name: 'Azure CLI (az)',
        parseVersion: parseAzVersion,
        versionArgs: ['version'],
        getLatestStable: getLatestAzStable,
        intro: 'Install the Azure CLI:',
        upgradeIntro: 'Update the Azure CLI:',
        commands: [
            'winget install Microsoft.AzureCLI',
            'brew install azure-cli',
            'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash',
        ],
        docsUrl: 'https://aka.ms/install-azure-cli',
    },
};

/**
 * Shells out to a single CLI's version command and returns the parsed version,
 * or `undefined` when the binary is absent, errors, or the output can't be
 * confirmed. Never throws.
 */
async function detectCliVersion(def: CliDefinition): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(def.id, def.versionArgs, {
            timeout: CLI_SHELL_TIMEOUT_MS,
            windowsHide: true,
            // On Windows `az`/`azd` are `.cmd`/`.bat` shims that execFile won't
            // resolve without the shell. The command and args are fixed
            // constants (no user input), so running through the shell is safe.
            shell: process.platform === 'win32',
        });
        return def.parseVersion(stdout);
    } catch {
        // Not installed / not on PATH / errored / timed out - treat as unknown.
        return undefined;
    }
}

/**
 * Detects only the installed versions of `azd` and `az` (no network). Used by the
 * deploy prerequisite gate to always record the detected versions in telemetry.
 * Never throws; an unconfirmable CLI reports `undefined`.
 */
export async function detectCliVersions(): Promise<Record<CliId, string | undefined>> {
    const [azd, az] = await Promise.all([
        detectCliVersion(CLI_DEFINITIONS.azd),
        detectCliVersion(CLI_DEFINITIONS.az),
    ]);
    return { azd, az };
}

/**
 * Full detection for the deployment plan's Prerequisites card: the installed
 * version plus the latest stable release (to compute the update-recommended
 * nudge). Only ever yields `installed` or `unknown` (D5). If the latest-stable
 * lookup fails (offline / feed error), the version is still shown without a
 * nudge (D7). Never throws.
 */
export async function detectDeploymentCliPrerequisites(): Promise<CliPrerequisite[]> {
    return Promise.all((Object.keys(CLI_DEFINITIONS) as CliId[]).map(id => detectOne(CLI_DEFINITIONS[id])));
}

async function detectOne(def: CliDefinition): Promise<CliPrerequisite> {
    const version = await detectCliVersion(def);
    const status: CliPrerequisiteStatus = statusForVersion(version);

    // Only bother querying the release feed when the CLI is actually installed;
    // an unknown CLI just shows install instructions with no version comparison.
    const latestVersion = version ? await def.getLatestStable() : undefined;
    const updateRecommended = isUpdateRecommended(version, latestVersion);

    return {
        id: def.id,
        name: def.name,
        status,
        version,
        latestVersion,
        updateRecommended,
        install: {
            intro: updateRecommended ? def.upgradeIntro : def.intro,
            commands: def.commands,
            docsUrl: def.docsUrl,
        },
    };
}

//#region Latest-stable lookups

/** Fetches text from a URL with a short timeout; returns `undefined` on any failure. */
async function fetchText(url: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LATEST_STABLE_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'vscode-azureresourcegroups' },
        });
        if (!response.ok) {
            return undefined;
        }
        return await response.text();
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

/** Latest stable `azd` from the GitHub release feed (tag `azure-dev-cli_1.29.0`). */
async function getLatestAzdStable(): Promise<string | undefined> {
    const body = await fetchText('https://api.github.com/repos/Azure/azure-dev/releases/latest');
    if (!body) {
        return undefined;
    }
    try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const tag = json['tag_name'];
        return typeof tag === 'string' ? parseAzdVersion(tag) : undefined;
    } catch {
        return undefined;
    }
}

/** Latest stable `az` from the PyPI `azure-cli` package metadata. */
async function getLatestAzStable(): Promise<string | undefined> {
    const body = await fetchText('https://pypi.org/pypi/azure-cli/json');
    if (!body) {
        return undefined;
    }
    try {
        const json = JSON.parse(body) as { info?: { version?: string } };
        return parseAzVersion(`{"azure-cli":"${json.info?.version ?? ''}"}`);
    } catch {
        return undefined;
    }
}

//#endregion

//#region Telemetry helpers

/** Records a detected CLI version, using a clearly-empty value when unknown. */
export function cliVersionForTelemetry(version: string | undefined): string {
    return version ?? UNKNOWN_CLI_VERSION;
}

/**
 * Flat telemetry props for the detected CLI versions plus, at approval time,
 * whether an update was recommended for each. Unknown/undetected records as a
 * clearly-empty value and never crashes the gate.
 */
export function getCliPrerequisiteTelemetry(prerequisites: CliPrerequisite[] | undefined): Record<string, string | boolean> {
    const props: Record<string, string | boolean> = {};
    for (const id of Object.keys(CLI_DEFINITIONS) as CliId[]) {
        const prereq = prerequisites?.find(p => p.id === id);
        props[`${id}Version`] = cliVersionForTelemetry(prereq?.version);
        props[`${id}UpdateRecommended`] = prereq?.updateRecommended ?? false;
    }
    return props;
}

//#endregion
