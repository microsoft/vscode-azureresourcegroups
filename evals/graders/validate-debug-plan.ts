/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades `.azure/vscode-debug-plan.md` against the certified debug-plan validator.
 *
 * Contract checks (header, table integrity, required sections, checklist) live in
 * `evals/src/artifacts/localDebugPlan.ts`. Only scenario-specific expectations —
 * how many services this project has, which emulators it needs — are expressed here.
 *
 * Flags: --assert-status=<Planning|Approved|Executing|Implemented>
 *        --assert-service-count=N
 *        --assert-emulator=<substring>   (repeatable)
 *        --assert-no-emulators
 *        --assert-checklist
 */

import type { LocalDebugPlanExpectations } from '../src/artifacts/localDebugPlan.ts';
import { validateLocalDebugPlanArtifact } from '../src/artifacts/localDebugPlan.ts';
import { failWithIssues, readArtifact, runGrader } from './graderHarness.ts';

runGrader('vscode-debug-plan.md satisfies the debug plan contract', () => {
    const args = process.argv.slice(2);
    const content = readArtifact('.azure/vscode-debug-plan.md');

    const expectations: LocalDebugPlanExpectations = {
        expectedStatus: valueOf(args, '--assert-status'),
        expectedServiceCount: countOf(args, '--assert-service-count'),
        expectedEmulators: valuesOf(args, '--assert-emulator'),
        expectNoEmulators: args.includes('--assert-no-emulators'),
        requireChecklist: args.includes('--assert-checklist'),
    };

    const result = validateLocalDebugPlanArtifact(content, expectations);
    if (!result.valid) {
        failWithIssues('debug plan validation errors:', result.issues);
    }
});

function valueOf(args: string[], flag: string): string | undefined {
    const match = args.find(arg => arg.startsWith(`${flag}=`));
    return match?.slice(flag.length + 1) || undefined;
}

function valuesOf(args: string[], flag: string): string[] | undefined {
    const values = args.filter(arg => arg.startsWith(`${flag}=`)).map(arg => arg.slice(flag.length + 1)).filter(Boolean);
    return values.length ? values : undefined;
}

function countOf(args: string[], flag: string): number | undefined {
    const raw = valueOf(args, flag);
    if (raw === undefined) {
        return undefined;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        // A bad flag is a miswired eval spec, not a product defect. Throwing a plain
        // Error routes it to exit 3 so the report blames the harness.
        throw new Error(`Invalid ${flag}=${raw}: expected a non-negative integer`);
    }
    return parsed;
}
