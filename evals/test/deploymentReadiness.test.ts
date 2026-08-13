/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import {
    createAzdInstallCommand,
    createAzdPackageCommand,
    evaluateDeploymentReadiness,
    isDeploymentInfrastructureFailureCode,
    type DeploymentReadinessCommandRunner,
} from '../src/deploymentReadiness';

const referenceWorkspace = path.join(
    __dirname,
    '..',
    'grader-certification',
    'reference-node-fullstack',
);

interface RecordedCommand { name: string; command: string }

function createRunner(
    outcomes: Record<string, { success: boolean; failureKind?: 'commandExit' | 'runnerError'; stdout?: string; stderr?: string }>,
    recorded: RecordedCommand[] = [],
): DeploymentReadinessCommandRunner {
    return {
        run: async (name, command) => {
            recorded.push({ name, command });
            const outcome = outcomes[name] ?? { success: true };
            return {
                success: outcome.success,
                failureKind: outcome.failureKind,
                stdout: outcome.stdout ?? '',
                stderr: outcome.stderr ?? '',
            };
        },
    };
}

void test('a workspace with valid artifacts and a passing azd package is deployment ready', async () => {
    const recorded: RecordedCommand[] = [];
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({}, recorded),
    );

    assert.strictEqual(result.outcome, 'passed');
    assert.strictEqual(result.failureCode, undefined);
    assert.strictEqual(result.infrastructure, 'bicep');
    assert.deepStrictEqual(result.serviceNames, ['app']);
    assert.deepStrictEqual(recorded.map(entry => entry.name), ['azd toolchain', 'azd package']);
    assert.strictEqual(result.commands.length, 2);
    assert.ok(result.commands.every(command => command.kind === 'deployment'));
    assert.ok(result.commands.every(command => command.success));
});

void test('a failing azd package is attributed to the generated artifacts', async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd package': {
                success: false,
                failureKind: 'commandExit',
                stderr: "ERROR: The 'npm' kind is not supported for hook",
            },
        }),
    );

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'azdPackageFailed');
    assert.match(result.error ?? '', /not supported for hook/);
    assert.strictEqual(
        isDeploymentInfrastructureFailureCode(result.failureCode),
        false,
        'a package failure is a product defect and must stay in the success-rate denominator',
    );
});

void test('a missing azd toolchain is infrastructure, not a product defect', async () => {
    const recorded: RecordedCommand[] = [];
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd toolchain': { success: false, failureKind: 'commandExit', stderr: 'azd: command not found' },
        }, recorded),
    );

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'azdUnavailable');
    assert.ok(isDeploymentInfrastructureFailureCode(result.failureCode));
    assert.deepStrictEqual(
        recorded.map(entry => entry.name),
        ['azd toolchain'],
        'azd package must not run when the toolchain is unavailable',
    );
});

void test('a runner fault is classified separately from a package failure', async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd package': { success: false, failureKind: 'runnerError', stderr: 'sandbox exec timed out' },
        }),
    );

    assert.strictEqual(result.failureCode, 'deploymentRunnerError');
    assert.ok(isDeploymentInfrastructureFailureCode(result.failureCode));
});

void test('a thrown runner error is captured as command evidence instead of escaping', async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        {
            run: async () => {
                throw new Error('aca sandbox exec exploded');
            },
        },
    );

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'azdUnavailable');
    assert.strictEqual(result.commands.length, 1);
    assert.strictEqual(result.commands[0].failureKind, 'runnerError');
    assert.match(result.commands[0].stderr, /exploded/);
});

void test('a workspace without a deployment plan produces no synthetic pass', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-deploy-'));
    try {
        const recorded: RecordedCommand[] = [];
        const result = await evaluateDeploymentReadiness({ workspace }, createRunner({}, recorded));

        assert.strictEqual(result.outcome, 'failed');
        assert.strictEqual(result.failureCode, 'deploymentPlanMissing');
        assert.deepStrictEqual(recorded, [], 'no azd command should run without a deployment plan');
        assert.deepStrictEqual(result.commands, []);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

void test('invalid artifacts fail before azd runs so the defect is attributed precisely', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-deploy-'));
    try {
        await fs.mkdir(path.join(workspace, '.azure'), { recursive: true });
        await fs.copyFile(
            path.join(referenceWorkspace, '.azure', 'deployment-plan.md'),
            path.join(workspace, '.azure', 'deployment-plan.md'),
        );
        const recorded: RecordedCommand[] = [];
        const result = await evaluateDeploymentReadiness({ workspace }, createRunner({}, recorded));

        assert.strictEqual(result.outcome, 'failed');
        assert.strictEqual(result.failureCode, 'deploymentArtifactsInvalid');
        assert.ok(result.issues.length > 0, 'the specific artifact issues must be reported');
        assert.deepStrictEqual(recorded, [], 'azd must not run against artifacts already known to be invalid');
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

void test('the azd install command is idempotent and the package command is non-interactive', () => {
    const install = createAzdInstallCommand();
    assert.match(install, /command -v azd/, 'install must be skipped when azd already exists');
    assert.match(install, /aka\.ms\/install-azd\.sh/);

    const packageCommand = createAzdPackageCommand();
    assert.match(packageCommand, /--no-prompt/, 'an eval runs unattended');
    assert.match(
        packageCommand,
        /AZURE_ENV_NAME=/,
        'azd package aborts with "loading environment: prompt required" unless an environment is selected',
    );
});

void test('a stopped container runtime is infrastructure, not a generated-project defect', async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd package': {
                success: false,
                failureKind: 'commandExit',
                stderr: [
                    'ERROR: The container runtime (Docker/Podman) is not running.',
                    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
                ].join('\n'),
            },
        }),
    );

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'containerRuntimeUnavailable');
    assert.ok(
        isDeploymentInfrastructureFailureCode(result.failureCode),
        'a missing Docker daemon must not count against the product success rate',
    );
});

void test("azd's upgrade banner never masks the real diagnosis", async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd package': {
                success: false,
                failureKind: 'commandExit',
                stderr: [
                    'Update available: 1.29.0 -> 1.31.0',
                    'To update, run `azd update`',
                    'ERROR: failed packaging service app: missing entry point',
                ].join('\n'),
            },
        }),
    );

    assert.strictEqual(result.failureCode, 'azdPackageFailed');
    assert.match(result.error ?? '', /missing entry point/);
    assert.doesNotMatch(result.error ?? '', /Update available/);
});

void test('an egress-blocked azd download is infrastructure, not a generated-project defect', async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd package': {
                success: false,
                failureKind: 'commandExit',
                stderr: "ERROR: failed building service 'app': downloading pack: http error 403",
            },
        }),
    );

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'deploymentNetworkBlocked');
    assert.ok(
        isDeploymentInfrastructureFailureCode(result.failureCode),
        'deny-default egress must not count against the product success rate',
    );
});

void test('a genuine build defect is still attributed to the generated project', async () => {
    const result = await evaluateDeploymentReadiness(
        { workspace: referenceWorkspace },
        createRunner({
            'azd package': {
                success: false,
                failureKind: 'commandExit',
                stderr: "ERROR: failed building service 'app': prepackage hook failed: npm run build exited with code 1",
            },
        }),
    );

    assert.strictEqual(result.failureCode, 'azdPackageFailed');
    assert.strictEqual(isDeploymentInfrastructureFailureCode(result.failureCode), false);
});
