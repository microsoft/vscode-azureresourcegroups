/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure version parsing and comparison helpers for the `azd` / `az` deploy
 * prerequisite gate. Kept free of any VS Code / Node runtime dependency so the
 * parsing and the ">= 2 minor versions behind" tolerance logic can be unit
 * tested directly.
 */

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
}

/** Extracts the first `major.minor.patch` triple found in a string, if any. */
export function parseSemver(value: string | undefined): SemVer | undefined {
    if (!value) {
        return undefined;
    }
    const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
        return undefined;
    }
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Parses the version from `azd version` output, e.g.
 * `azd version 1.20.1 (commit 0000000000000000000000000000000000000000)`.
 * Returns the normalized `major.minor.patch` string, or `undefined` when the
 * output can't be confirmed as a version.
 */
export function parseAzdVersion(stdout: string | undefined): string | undefined {
    const parsed = parseSemver(stdout);
    return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : undefined;
}

/**
 * Parses the `azure-cli` version from `az version` output. Prefers the default
 * JSON shape (`{ "azure-cli": "2.89.0", ... }`) and falls back to the legacy
 * `az --version` text form (`azure-cli 2.89.0 ...`). Returns the normalized
 * `major.minor.patch` string, or `undefined` when it can't be confirmed.
 */
export function parseAzVersion(stdout: string | undefined): string | undefined {
    if (!stdout) {
        return undefined;
    }
    try {
        const json = JSON.parse(stdout) as Record<string, unknown>;
        const core = json['azure-cli'];
        if (typeof core === 'string') {
            const parsed = parseSemver(core);
            if (parsed) {
                return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
            }
        }
    } catch {
        // Not JSON (older text output); fall through to the regex form below.
    }
    const match = stdout.match(/azure-cli\s+\*?\s*(\d+\.\d+\.\d+)/i);
    return match ? parseAzVersion(`{"azure-cli":"${match[1]}"}`) : undefined;
}

/**
 * Maps a detected version to the only two states we surface for a CLI (D5):
 * `installed` when a version was confirmed, otherwise `unknown`. It is
 * intentionally impossible for this to return `missing` - a sandbox can hide a
 * real binary, so we never assert absence for `azd` / `az`.
 */
export function statusForVersion(version: string | undefined): 'installed' | 'unknown' {
    return version ? 'installed' : 'unknown';
}

/**
 * Decides whether an update should be *recommended* for an installed CLI given
 * the latest stable release. The tolerance (D7): flag only when the installed
 * version is **>= 2 minor versions behind** the latest stable, or a whole major
 * version behind. Patch drift and being exactly one minor behind (the most
 * recent minor) are tolerated. When either version can't be parsed - including
 * when the latest-stable lookup failed and returns `undefined` - this returns
 * `false` so a failed lookup degrades to "no nudge" rather than a false alarm.
 */
export function isUpdateRecommended(installedVersion: string | undefined, latestVersion: string | undefined): boolean {
    const installed = parseSemver(installedVersion);
    const latest = parseSemver(latestVersion);
    if (!installed || !latest) {
        return false;
    }
    if (installed.major !== latest.major) {
        // A whole major behind is out of date; being ahead (e.g. a dev build) is not.
        return latest.major > installed.major;
    }
    return latest.minor - installed.minor >= 2;
}
