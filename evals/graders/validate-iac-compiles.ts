/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the deploy scaffold phase the way `validate-project-builds` grades the project
 * scaffold: by running the real compiler over what the agent generated, rather than reading
 * the files and deciding they look plausible.
 *
 * This gate provisions nothing. That is not a limitation worked around — it is the phase
 * boundary the product already draws. `azure-deploy/scaffold/references/subagent-validate.md`
 * says "Do NOT create or modify Azure resources — validation is syntax-only (`bicep build`),
 * never `az deployment sub create`" and "Do NOT run `what-if`". So the whole contract of this
 * phase is checkable for the price of a compile, with no subscription and no spend.
 *
 * ## What it adds over the agent's own check
 *
 * The agent already runs `az bicep build` and records the outcome in `scaffold-manifest.json`.
 * Re-running it is not redundant, because the agent is told to read the result the wrong way:
 * step 11a of `validation-and-manifest.md` says "Pass: exit 0", and bicep exits 0 on a
 * hallucinated resource type, a nonexistent API version, a missing required property and a
 * mistyped property alike. See `../src/artifacts/iacCompiles.ts` for the measured table.
 *
 * So the interesting verdict is not "did it compile" but **"is the agent's report of whether
 * it compiled true"**. `selfReportContradictsCompiler` is that verdict, and an agent can reach
 * it while following its instructions exactly — which makes it a finding about the contract
 * rather than about one run.
 *
 * ## Why a clean compile is not taken at face value
 *
 * `#disable-next-line BCP035` above a resource missing its required properties produces no
 * output and exit 0 on bicep 0.46.1, so a clean compile can be bought with a comment rather
 * than earned. The agent has been taught that syntax — `bicep-patterns-security.md` tells it
 * to write `#disable-next-line no-hardcoded-env-urls` — so this gate scans every `.bicep` it
 * can reach, including modules, and fails a compile that was only clean because something
 * this gate blocks on was silenced. Suppressing a rule the gate does not block on, such as
 * that sanctioned one, is not a finding; see `suppressesBlockingDiagnostic` for why that
 * distinction is derived rather than listed.
 *
 * ## Not-applicable rather than pass
 *
 * Terraform IaC exits 3 with a marker naming the gap, always: a bicep gate that returns green
 * on a Terraform project is indistinguishable from no gate at all, and one that fails it is
 * grading our backlog rather than the agent. See `NOT_APPLICABLE_EXIT_CODE` in the harness.
 *
 * An absence of IaC is read against what the stimulus asked for. A plan-only run that wrote no
 * templates is genuinely not this gate's question; a run told to generate them that produced
 * none has failed in the most complete way available to it, and reporting that as a skip would
 * turn the gate's loudest finding into silence.
 *
 * Flags:
 *   --strict-types             restore BCP081 to blocking. Off by default: BCP081 also fires on
 *                              valid API versions newer than the pinned bicep's type index, so
 *                              blocking it penalises agents for being current. See iacCompiles.ts.
 *   --require-artifacts        the stimulus contracted the agent to produce IaC and a scaffold
 *                              manifest, so the absence of either is a finding rather than a
 *                              reason to stand down
 */

import { spawnSync } from 'node:child_process';
import {
    classifyBicepOutput,
    describeDiagnostic,
    discoverIac,
    IAC_NOT_APPLICABLE_CODES,
    readSelfReportedBicepBuildVerdict,
    selfReportContradictsCompiler,
    validateScaffoldedIac,
} from '../src/artifacts/iacCompiles.ts';
import {
    fail,
    failAsHarnessFault,
    failWithIssues,
    gateId,
    runGraderAsync,
    skipAsNotApplicable,
    workspacePath,
} from './graderHarness.ts';

/**
 * Compile one template. Returns the combined output and exit status; classification is the
 * caller's job so the decision stays in the pure module that the self-test covers.
 */
function compile(entryPoint: string): { output: string; status: number | null } {
    const result = spawnSync('az', ['bicep', 'build', '--file', entryPoint, '--stdout'], {
        encoding: 'utf8',
        timeout: 5 * 60_000,
        // On Windows `az` is `az.cmd`, a batch file CreateProcess cannot execute, and since
        // CVE-2024-27980 Node refuses to spawn `.cmd` without a shell. Safe here because
        // every argument is a hardcoded literal except a path we resolved ourselves.
        shell: process.platform === 'win32',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

    // "I could not run the compiler" is not evidence that the template is broken. Without a
    // shell that arrives as a spawn error; with one, the shell starts fine and complains on
    // stdout with a non-zero exit, so both shapes have to be checked. Same reasoning, and the
    // same failure mode, as the npm handling in validate-project-builds.ts.
    const azMissing = /'az(\.\w+)?' is not recognized|\baz: (command )?not found|command not found: az\b/i.test(output);
    // Three distinct strings, because `az bicep build` and `az bicep version` fail differently.
    // Only `version` raises "Bicep CLI not found" — it runs with `auto_install=False`. `build`
    // auto-installs, so when it cannot produce a compiler it either fails the download
    // ("Error while attempting to download Bicep CLI") or, when `bicep.use_binary_from_path`
    // resolves true, reports that nothing named `bicep` is on PATH. Matching only the first
    // string meant the two shapes `build` actually emits fell through to the classifier,
    // parsed as zero diagnostics with a non-zero exit, and were billed to the agent as exit 1
    // — accusing it of shipping broken IaC because *we* had no compiler.
    const bicepMissing = /Bicep CLI not found|attempting to download Bicep CLI|Could not find the "bicep" executable on PATH/i.test(output);
    const spawnFailed = result.error && (result.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT';
    if (spawnFailed || azMissing || bicepMissing) {
        const detail = bicepMissing
            ? 'the Bicep CLI is not installed; run `az bicep install`'
            : result.error?.message ?? 'az is not on PATH';
        failAsHarnessFault(`could not compile ${entryPoint}: ${detail}`);
    }
    if (result.error) {
        // A timeout is the template's problem, not ours.
        fail(`compiling ${entryPoint} did not finish within 5 minutes`);
    }
    return { output, status: result.status };
}

void runGraderAsync('generated infrastructure compiles and the agent reported it honestly', async () => {
    const flags = process.argv.slice(2);
    const strictTypes = flags.includes('--strict-types');
    const requireArtifacts = flags.includes('--require-artifacts');

    const workspaceRoot = workspacePath('.');
    const iac = discoverIac(workspaceRoot);

    // Everything decidable without a compiler: is there IaC, did the phase leave a manifest,
    // and is the manifest's own account of its validation internally coherent.
    const offline = await validateScaffoldedIac(workspaceRoot, { strictTypes });

    // Two different silences, and only one of them is ours. `coverageGap` means the agent built
    // something legitimate that this gate cannot read, which is a gap in the harness and must
    // never be charged to the run. `outOfScope` means there is nothing to read, and whether
    // that is a finding depends entirely on what the stimulus asked for.
    const notApplicable = offline.issues.find(issue => issue.code in IAC_NOT_APPLICABLE_CODES);
    if (notApplicable) {
        const classification = IAC_NOT_APPLICABLE_CODES[notApplicable.code];
        if (classification === 'coverageGap' || !requireArtifacts) {
            skipAsNotApplicable(gateId(), classification, notApplicable.code, notApplicable.message);
        }
        fail(`this stimulus asked the agent to generate deployment infrastructure and none reached the workspace: ${notApplicable.message}`);
    }

    // A stimulus that only asked for a scaffold has no manifest to grade, and failing it for
    // that would grade a contract the agent was never invoked under.
    const suppressionIssues = offline.issues.filter(issue => issue.code === 'suppressedBlockingDiagnostic');
    const manifestIssues = offline.issues.filter(issue =>
        issue.code !== 'suppressedBlockingDiagnostic'
        && (requireArtifacts || issue.code !== 'missingScaffoldManifest'));
    // Read from the "bicep build" check itself, not from the manifest's overall validity — a
    // manifest can be wrong in some other way and still contain a false claim about the build,
    // and that combination is the most incriminating one there is.
    const selfReportedPass = await readSelfReportedBicepBuildVerdict(workspaceRoot);

    process.stderr.write(`[iac-compiles] compiling ${iac.relative}\n`);
    const { output, status } = compile(iac.entryPoint!);
    const outcome = classifyBicepOutput(output, status, { strictTypes });

    for (const diagnostic of outcome.advisory) {
        process.stderr.write(`[iac-compiles] advisory ${describeDiagnostic(diagnostic)}\n`);
    }

    if (!outcome.compiled) {
        const detail = outcome.blocking.map(diagnostic => `  • ${describeDiagnostic(diagnostic)}`).join('\n')
            || `  • bicep exited ${status} with no diagnostic this grader could parse:\n${output}`;
        // The two ways to arrive here are worth distinguishing in the message, because they
        // are findings about different things: a template that does not compile is a bad run,
        // while a template that does not compile *and* was reported as validated is a bad
        // contract — the agent did what it was told and still shipped broken infrastructure.
        const preamble = selfReportContradictsCompiler(selfReportedPass, outcome.compiled)
            ? 'the agent recorded "bicep build": "PASS" but the generated infrastructure does not compile'
            : 'the generated infrastructure does not compile';
        fail(`${preamble}:\n${detail}`);
    }

    // Reported before the manifest issues and only after the compile passes, because this is
    // the case the check exists for: a clean compile bought by silencing the compiler is the
    // one result this gate would otherwise call a success.
    if (suppressionIssues.length > 0) {
        failWithIssues('the generated infrastructure compiles, but only because diagnostics this gate blocks on were suppressed in the template:', suppressionIssues);
    }

    if (manifestIssues.length > 0) {
        failWithIssues('the generated infrastructure compiles, but the scaffold manifest is wrong:', manifestIssues);
    }

    process.stderr.write(`[iac-compiles] ${iac.relative} compiled cleanly (${outcome.advisory.length} advisory)\n`);
});
