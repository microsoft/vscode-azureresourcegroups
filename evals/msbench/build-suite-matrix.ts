/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const stimuliRoot = join(import.meta.dirname, 'config', 'stimuli');
const customDataset = 'evals/msbench/container/dataset.jsonl';
const models = ['gpt-5.6-sol', 'claude-sonnet-5'] as const;
const weeklyCore = [
    'plan-feedback-recipe-app',
    'scaffold-fullstack',
    'scaffold-api-only',
    'integrate-seam',
    'debug-generate-artifacts',
    'debug-generate-deploy-handoff',
    'deploy-scaffold-iac',
] as const;

interface MatrixEntry {
    stimulus: string;
    model: typeof models[number];
    benchmark: string;
    dataset: string;
}

function phaseOf(stimulus: string): string {
    const content = readFileSync(join(stimuliRoot, `${stimulus}.yaml`), 'utf8');
    return /^#\s*phase:\s*(\S+)\s*$/im.exec(content)?.[1] ?? 'plan';
}

function executionEnvironment(stimulus: string): Pick<MatrixEntry, 'benchmark' | 'dataset'> {
    const phase = phaseOf(stimulus);
    const emulatorFreeLocalStimuli = new Set([
        'debug-generate-deploy-handoff',
        'gates-selftest-prescaffolded',
    ]);
    return (phase === 'local' && !emulatorFreeLocalStimuli.has(stimulus)) || phase === 'functions-breakpoint'
        ? { benchmark: 'corbench.cor_functions_host', dataset: customDataset }
        : { benchmark: 'vscbench.say_hello', dataset: '' };
}

export function buildSuiteMatrix(suite: string): { include: MatrixEntry[] } {
    if (suite !== 'weekly-core' && suite !== 'full') {
        throw new Error(`Unknown suite "${suite}". Expected weekly-core or full.`);
    }

    const stimuli = suite === 'full'
        ? readdirSync(stimuliRoot)
            .filter(file => file.endsWith('.yaml'))
            .map(file => basename(file, '.yaml'))
            .sort()
        : [...weeklyCore];

    for (const stimulus of stimuli) {
        if (!existsSync(join(stimuliRoot, `${stimulus}.yaml`))) {
            throw new Error(`Suite "${suite}" references missing stimulus "${stimulus}".`);
        }
    }

    return {
        include: stimuli.flatMap(stimulus => {
            const environment = executionEnvironment(stimulus);
            return models.map(model => ({ stimulus, model, ...environment }));
        }),
    };
}

function selfTest(): void {
    const weekly = buildSuiteMatrix('weekly-core').include;
    const full = buildSuiteMatrix('full').include;
    if (weekly.length !== weeklyCore.length * models.length) {
        throw new Error(`Expected ${weeklyCore.length * models.length} weekly entries, found ${weekly.length}.`);
    }
    if (full.length !== readdirSync(stimuliRoot).filter(file => file.endsWith('.yaml')).length * models.length) {
        throw new Error('Full matrix does not include every stimulus on both models.');
    }
    const debug = weekly.find(entry => entry.stimulus === 'debug-generate-artifacts');
    if (debug?.benchmark !== 'corbench.cor_functions_host' || debug.dataset !== customDataset) {
        throw new Error('Local-development stimuli must use the custom Functions container.');
    }
    const handoff = weekly.find(entry => entry.stimulus === 'debug-generate-deploy-handoff');
    if (handoff?.benchmark !== 'vscbench.say_hello' || handoff.dataset !== '') {
        throw new Error('The isolated deploy handoff should use the cheaper stock container.');
    }
    const plan = weekly.find(entry => entry.stimulus === 'plan-feedback-recipe-app');
    if (plan?.benchmark !== 'vscbench.say_hello' || plan.dataset !== '') {
        throw new Error('Plan stimuli should continue borrowing the stock say_hello container.');
    }
    console.log(`suite matrix self-test passed: weekly=${weekly.length}, full=${full.length}`);
}

const argument = process.argv[2];
if (argument === '--self-test') {
    selfTest();
} else {
    console.log(JSON.stringify(buildSuiteMatrix(argument ?? 'weekly-core')));
}
