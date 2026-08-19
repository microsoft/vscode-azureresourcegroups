#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fails fast when the Copilot credential is missing or in a format the CLI ignores.
 *
 * Without this check an unset secret still starts the run, and then every trial dies
 * with `Session was not created with authentication info or custom provider` — an
 * opaque message that arrives ~25 minutes later and looks exactly like a product
 * regression. A missing credential is a configuration problem, so it should be
 * reported in seconds and in those words.
 *
 * The Copilot CLI resolves its token as
 * `COPILOT_GITHUB_TOKEN || GH_TOKEN || GITHUB_TOKEN`, and it explicitly refuses
 * classic PATs: "Classic Personal Access Tokens (ghp_) are not supported ... Use
 * /login to authenticate, or replace it with a fine-grained PAT."
 */

import path from 'node:path';

const TOKEN_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];
/**
 * Mirrors the CLI's resolution order so this check and the run agree on which
 * variable is actually in play.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ name: string, value: string } | undefined}
 */
export function resolveToken(env) {
    for (const name of TOKEN_VARS) {
        const value = env[name];
        if (value) {
            return { name, value };
        }
    }
    return undefined;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: boolean, level: 'error' | 'warning' | 'ok', message: string }}
 */
export function checkCopilotAuth(env) {
    const resolved = resolveToken(env);
    if (!resolved) {
        return {
            ok: false,
            level: 'error',
            message: [
                `No Copilot credential found. Set one of ${TOKEN_VARS.join(', ')}.`,
                'In GitHub Actions this should be the built-in github.token, with `permissions: copilot-requests: write` on the job — no secret or PAT is required.',
                'Without a credential every trial fails with "Session was not created with authentication info or custom provider".',
                'Outside Actions, export COPILOT_GITHUB_TOKEN with a fine-grained PAT (github_pat_...) that has Copilot Requests: Read.',
            ].join('\n'),
        };
    }

    if (resolved.value.startsWith('ghp_')) {
        return {
            ok: false,
            level: 'error',
            message: [
                `${resolved.name} contains a classic PAT (ghp_), which the Copilot CLI ignores.`,
                'Every trial would fail to authenticate. Fix: replace it with a fine-grained PAT (github_pat_...).',
            ].join('\n'),
        };
    }

    if (resolved.value.startsWith('ghs_')) {
        return {
            ok: true,
            level: 'ok',
            message: `${resolved.name} is a GitHub Actions token. This authenticates Copilot only while the job requests \`copilot-requests: write\`; if trials fail to authenticate, check that permission first.`,
        };
    }

    return { ok: true, level: 'ok', message: `${resolved.name} is present and in a supported format.` };
}

// Only run when invoked directly, so the checks above stay unit-testable.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
    const result = checkCopilotAuth(process.env);
    const [summary, ...details] = result.message.split('\n');
    const stream = result.ok ? process.stdout : process.stderr;
    // Annotations are single-line, so only the summary is annotated; the rest is
    // printed plainly so it stays readable in the raw log.
    stream.write(result.level === 'ok' ? `${summary}\n` : `::${result.level}::${summary}\n`);
    for (const line of details) {
        stream.write(`${line}\n`);
    }
    process.exit(result.ok ? 0 : 1);
}
