/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { CorEvaluationScenario } from './scenario';

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set(['.git', '.azure', 'dist', 'node_modules', 'out']);
const maxLogLength = 20_000;

export type ValidationEcosystem = 'node' | 'python' | 'dotnet';
const pythonValidationDirectory = '.cor-eval-venv';
const pythonValidationInterpreter = `${pythonValidationDirectory}/bin/python`;
const pythonValidationPip = `${pythonValidationDirectory}/bin/pip`;

export interface ProjectValidationTarget {
    ecosystem: ValidationEcosystem;
    relativeDirectory: string;
    commands: string[];
}

interface NodePackageInfo {
    directory: string;
    relativeDirectory: string;
    scripts: Record<string, string>;
    workspacePatterns: string[];
    hasPackageLock: boolean;
}

export interface SandboxValidationCommandResult {
    ecosystem: ValidationEcosystem;
    relativeDirectory: string;
    command: string;
    success: boolean;
    failureKind?: 'commandExit' | 'runnerError';
    durationMs: number;
    stdout: string;
    stderr: string;
}

export type SandboxValidationCommandKind = 'build' | 'test' | 'lint';

export interface SandboxProjectValidationResult {
    outcome: 'passed' | 'failed';
    failureCode?: 'noBuildTargets' | 'sandboxCreateFailed' | 'sandboxSetupFailed' | 'sandboxCommandFailed' | 'sandboxCleanupFailed';
    error?: string;
    commands: SandboxValidationCommandResult[];
}

export interface AcaCommandResult {
    stdout: string;
    stderr: string;
}

export interface AcaCommandRunner {
    run(args: string[], timeoutMs: number): Promise<AcaCommandResult>;
}

export function isSandboxInfrastructureFailureCode(code: string | undefined): boolean {
    return [
        'sandboxCreateFailed',
        'sandboxSetupFailed',
        'sandboxCleanupFailed',
        'agentRunTimedOut',
        'agentRunStalled',
    ].includes(code ?? '');
}

export function classifySandboxValidationCommand(
    command: Pick<SandboxValidationCommandResult, 'ecosystem' | 'command'>,
): SandboxValidationCommandKind | undefined {
    const value = command.command.trim();
    switch (command.ecosystem) {
        case 'node':
            if (/Missing required npm script: build/u.test(value)) {
                return 'build';
            }
            if (/Missing required npm script: test/u.test(value)) {
                return 'test';
            }
            if (/Missing required npm script: lint/u.test(value)) {
                return 'lint';
            }
            if (/^npm\s+run\s+build(?:\s|$)/u.test(value)) {
                return 'build';
            }
            if (/^npm\s+(?:run\s+)?test(?:\s|$)/u.test(value)) {
                return 'test';
            }
            if (/^npm\s+run\s+lint(?:\s|$)/u.test(value)) {
                return 'lint';
            }
            return undefined;
        case 'python':
            if (/Missing required Python lint configuration/u.test(value)) {
                return 'lint';
            }
            if (/\s-m\s+compileall(?:\s|$)/u.test(value)) {
                return 'build';
            }
            if (/\s-m\s+pytest(?:\s|$)/u.test(value)) {
                return 'test';
            }
            if (/\s-m\s+ruff\s+check(?:\s|$)/u.test(value)) {
                return 'lint';
            }
            return undefined;
        case 'dotnet':
            if (/^dotnet\s+build(?:\s|$)/u.test(value)) {
                return 'build';
            }
            if (/^dotnet\s+test(?:\s|$)/u.test(value)) {
                return 'test';
            }
            if (/^dotnet\s+format\b.*\s--verify-no-changes(?:\s|$)/u.test(value)) {
                return 'lint';
            }
            return undefined;
    }
}

export function canContinueAfterProjectValidationFailure(
    validation: SandboxProjectValidationResult,
): boolean {
    if (validation.outcome !== 'failed' || validation.failureCode !== 'sandboxCommandFailed') {
        return false;
    }
    const failedCommands = validation.commands.filter(command => !command.success);
    return failedCommands.length > 0 && failedCommands.every(command => {
        const kind = classifySandboxValidationCommand(command);
        return command.failureKind === 'commandExit' && (kind === 'test' || kind === 'lint');
    });
}

export class SandboxProjectValidator {
    public constructor(
        private readonly repoRoot: string,
        private readonly aca: AcaCommandRunner = new DefaultAcaCommandRunner(),
    ) {
    }

    public async validate(workspace: string, scenario: CorEvaluationScenario): Promise<SandboxProjectValidationResult> {
        const targets = await discoverProjectValidationTargets(workspace, scenario);
        if (!targets.length) {
            return {
                outcome: 'failed',
                failureCode: 'noBuildTargets',
                error: 'The scaffold did not produce a supported Node, Python, or .NET build target.',
                commands: [],
            };
        }

        const archivePath = path.join(os.tmpdir(), `cor-eval-${randomUUID()}.tar.gz`);
        const commands: SandboxValidationCommandResult[] = [];
        let qualityFailure: SandboxProjectValidationResult | undefined;
        try {
            await createWorkspaceArchive(workspace, archivePath);
            for (const [ecosystem, ecosystemTargets] of groupTargets(targets)) {
                const result = await this.validateEcosystem(ecosystem, ecosystemTargets, archivePath, scenario, commands);
                if (result) {
                    if (canContinueAfterProjectValidationFailure(result)) {
                        qualityFailure ??= result;
                    } else {
                        return result;
                    }
                }
            }
            return qualityFailure ?? { outcome: 'passed', commands };
        } finally {
            await fs.rm(archivePath, { force: true });
        }
    }

    private async validateEcosystem(
        ecosystem: ValidationEcosystem,
        targets: ProjectValidationTarget[],
        archivePath: string,
        scenario: CorEvaluationScenario,
        commands: SandboxValidationCommandResult[],
    ): Promise<SandboxProjectValidationResult | undefined> {
        const runLabel = randomUUID();
        const manifestPath = path.join(os.tmpdir(), `cor-eval-${runLabel}-${ecosystem}.yaml`);
        let sandboxId: string;
        try {
            await createSandboxManifest(this.getManifestPath(ecosystem), manifestPath, runLabel);
            await this.aca.run([
                'sandbox',
                'validate',
                '--file',
                manifestPath,
            ], 60 * 1000);
            const created = await this.aca.run([
                'sandbox',
                'apply',
                '--file',
                manifestPath,
                '--wait-timeout',
                '300',
                '-o',
                'json',
            ], 6 * 60 * 1000);
            sandboxId = readSandboxId(created.stdout);
        } catch (error) {
            const cleanupError = await this.cleanupAfterCreateFailure(error, runLabel);
            return {
                outcome: 'failed',
                failureCode: 'sandboxCreateFailed',
                error: [getErrorMessage(error), cleanupError].filter(Boolean).join(' '),
                commands,
            };
        } finally {
            await fs.rm(manifestPath, { force: true });
        }

        let validationFailure: SandboxProjectValidationResult | undefined;
        try {
            await this.aca.run([
                'sandbox', 'exec',
                '--id', sandboxId,
                '-c', getToolchainCheckCommand(ecosystem),
            ], 60 * 1000);
            await this.aca.run([
                'sandbox', 'fs', 'write',
                '--id', sandboxId,
                '--path', '/tmp/workspace.tar.gz',
                '--file', archivePath,
            ], 5 * 60 * 1000);
            await this.aca.run([
                'sandbox', 'exec',
                '--id', sandboxId,
                '--working-directory', '/tmp',
                '-c', 'mkdir -p /workspace && tar -xzf /tmp/workspace.tar.gz -C /workspace',
            ], 5 * 60 * 1000);
        } catch (error) {
            validationFailure = {
                outcome: 'failed',
                failureCode: 'sandboxSetupFailed',
                error: getErrorMessage(error),
                commands,
            };
        }
        if (!validationFailure) {
            try {
                validation: for (const target of targets) {
                    for (const command of target.commands) {
                        const commandResult = await this.runValidationCommand(
                            sandboxId,
                            target,
                            command,
                            scenario.validation.timeoutMinutes * 60 * 1000,
                        );
                        commands.push(commandResult);
                        if (!commandResult.success) {
                            const failure: SandboxProjectValidationResult = {
                                outcome: 'failed',
                                failureCode: 'sandboxCommandFailed',
                                error: `${target.relativeDirectory}: "${command}" failed.`,
                                commands,
                            };
                            if (canContinueAfterProjectValidationFailure(failure)) {
                                validationFailure ??= failure;
                                continue;
                            }
                            validationFailure = failure;
                            break validation;
                        }
                    }
                }
            } catch (error) {
                validationFailure = {
                    outcome: 'failed',
                    failureCode: 'sandboxCommandFailed',
                    error: getErrorMessage(error),
                    commands,
                };
            }
        }

        try {
            await this.aca.run(['sandbox', 'delete', '--id', sandboxId, '--yes'], 5 * 60 * 1000);
        } catch (error) {
            return {
                outcome: 'failed',
                failureCode: 'sandboxCleanupFailed',
                error: getErrorMessage(error),
                commands,
            };
        }
        return validationFailure;
    }

    private async cleanupAfterCreateFailure(error: unknown, runLabel: string): Promise<string | undefined> {
        const commandError = error as Error & { stdout?: string; stderr?: string };
        const sandboxIds = new Set<string>();
        const explicitId = tryReadSandboxId([commandError.stdout, commandError.stderr].filter(Boolean).join('\n'));
        if (explicitId) {
            sandboxIds.add(explicitId);
        }

        let recoveryError: string | undefined;
        try {
            const listed = await this.aca.run([
                'sandbox', 'list',
                '-l', `run-id=${runLabel}`,
                '-o', 'json',
            ], 60 * 1000);
            for (const id of readSandboxIds(listed.stdout)) {
                sandboxIds.add(id);
            }
        } catch (listError) {
            if (!sandboxIds.size) {
                recoveryError = `Could not recover a created sandbox by label: ${getErrorMessage(listError)}`;
            }
        }

        const deleteErrors: string[] = [];
        for (const id of sandboxIds) {
            try {
                await this.aca.run(['sandbox', 'delete', '--id', id, '--yes'], 5 * 60 * 1000);
            } catch (deleteError) {
                deleteErrors.push(`${id}: ${getErrorMessage(deleteError)}`);
            }
        }
        if (deleteErrors.length) {
            return `Sandbox cleanup failed: ${deleteErrors.join('; ')}`;
        }
        return recoveryError;
    }

    private async runValidationCommand(
        sandboxId: string,
        target: ProjectValidationTarget,
        command: string,
        timeoutMs: number,
    ): Promise<SandboxValidationCommandResult> {
        const started = Date.now();
        const remoteExitMarker = `__COR_EVAL_REMOTE_EXIT_${randomUUID()}__=`;
        const wrappedCommand = `( ${command} ); __cor_eval_status=$?; `
            + `printf '\\n${remoteExitMarker}%s\\n' "$__cor_eval_status" >&2; `
            + 'exit "$__cor_eval_status"';
        try {
            const result = await this.aca.run([
                'sandbox', 'exec',
                '--id', sandboxId,
                '--working-directory', toSandboxPath(target.relativeDirectory),
                '-c', wrappedCommand,
            ], timeoutMs);
            const stderr = removeRemoteExitMarker(result.stderr, remoteExitMarker);
            return {
                ecosystem: target.ecosystem,
                relativeDirectory: target.relativeDirectory,
                command,
                success: true,
                durationMs: Date.now() - started,
                stdout: truncate(result.stdout),
                stderr: truncate(stderr.output),
            };
        } catch (error) {
            const commandError = error as Error & { stdout?: string; stderr?: string };
            const stderr = removeRemoteExitMarker(commandError.stderr ?? '', remoteExitMarker);
            return {
                ecosystem: target.ecosystem,
                relativeDirectory: target.relativeDirectory,
                command,
                success: false,
                failureKind: stderr.exitCode !== undefined && stderr.exitCode !== 0
                    ? 'commandExit'
                    : 'runnerError',
                durationMs: Date.now() - started,
                stdout: truncate(commandError.stdout ?? ''),
                stderr: truncate(stderr.output || getErrorMessage(error)),
            };
        }
    }

    private getManifestPath(ecosystem: ValidationEcosystem): string {
        switch (ecosystem) {
            case 'node':
                return path.join(this.repoRoot, 'evals', 'sandbox.yaml');
            case 'python':
                return path.join(this.repoRoot, 'evals', 'sandbox-python.yaml');
            case 'dotnet':
                return path.join(this.repoRoot, 'evals', 'sandbox-dotnet.yaml');
        }
    }
}

export async function discoverProjectValidationTargets(
    workspace: string,
    scenario: CorEvaluationScenario,
): Promise<ProjectValidationTarget[]> {
    const files = await listProjectFiles(workspace);
    const targets: ProjectValidationTarget[] = [];

    const nodePackages = await Promise.all(
        files
            .filter(file => path.basename(file) === 'package.json')
            .map(file => readNodePackageInfo(workspace, file)),
    );
    nodePackages.sort((left, right) =>
        pathDepth(left.relativeDirectory) - pathDepth(right.relativeDirectory)
        || left.relativeDirectory.localeCompare(right.relativeDirectory));
    const workspaceRoots = new Map<NodePackageInfo, NodePackageInfo | undefined>();
    for (const nodePackage of nodePackages) {
        workspaceRoots.set(nodePackage, findWorkspaceRoot(nodePackage, nodePackages));
    }
    for (const nodePackage of nodePackages) {
        const workspaceRoot = workspaceRoots.get(nodePackage);
        const workspaceMembers = nodePackages.filter(candidate => workspaceRoots.get(candidate) === nodePackage);
        const commands: string[] = [];
        if (!workspaceRoot) {
            commands.push(nodePackage.hasPackageLock ? 'npm ci --ignore-scripts' : 'npm install --ignore-scripts');
        }
        for (const validation of getRequestedNodeValidations(scenario)) {
            if (workspaceRoot?.scripts[validation.script]) {
                continue;
            }
            const script = nodePackage.scripts[validation.script];
            if (script) {
                commands.push(validation.command);
            } else if (validation.required && workspaceMembers.length === 0) {
                commands.push(missingScriptCommand(validation.script));
            }
        }
        if (commands.length) {
            targets.push(createTarget('node', workspace, nodePackage.directory, commands));
        }
    }

    const pythonDirectories = [...new Set(
        files
            .filter(file => ['requirements.txt', 'pyproject.toml'].includes(path.basename(file)))
            .map(file => path.dirname(file)),
    )].sort();
    for (const directory of pythonDirectories) {
        const commands = [
            `python -m venv ${pythonValidationDirectory}`,
            ...await createPythonInstallCommands(directory, files),
        ];
        if (scenario.validation.build) {
            commands.push(`${pythonValidationInterpreter} -m compileall -q .`);
        }
        if (scenario.validation.test) {
            commands.push(`${pythonValidationInterpreter} -m pytest`);
        }
        const pythonLintCommand = await detectPythonLintCommand(directory);
        if (pythonLintCommand && scenario.validation.lint !== 'skip') {
            commands.push(pythonLintCommand);
        } else if (!pythonLintCommand && scenario.validation.lint === 'required') {
            commands.push(missingPythonLintCommand());
        }
        targets.push(createTarget('python', workspace, directory, commands));
    }

    const solutions = files.filter(file => file.endsWith('.sln'));
    const dotnetProjects = solutions.length ? solutions : files.filter(file => file.endsWith('.csproj'));
    for (const file of dotnetProjects) {
        const commands = ['dotnet restore'];
        if (scenario.validation.build) {
            commands.push('dotnet build --no-restore');
        }
        if (scenario.validation.test) {
            commands.push('dotnet test --no-build');
        }
        if (scenario.validation.lint === 'required'
            || (scenario.validation.lint === 'if-present' && await hasDotnetLintConfiguration(path.dirname(file)))) {
            commands.push('dotnet format --verify-no-changes --no-restore');
        }
        targets.push(createTarget('dotnet', workspace, path.dirname(file), commands));
    }

    return targets;
}

async function createPythonInstallCommands(directory: string, files: string[]): Promise<string[]> {
    const requirementFiles = files
        .filter(file => path.dirname(file) === directory
            && /^requirements(?:[-_.](?:dev|test|tests|lint))?\.txt$/i.test(path.basename(file)))
        .sort((left, right) => {
            const leftBase = path.basename(left).toLowerCase();
            const rightBase = path.basename(right).toLowerCase();
            if (leftBase === 'requirements.txt') {
                return -1;
            }
            if (rightBase === 'requirements.txt') {
                return 1;
            }
            return leftBase.localeCompare(rightBase);
        });
    const commands = requirementFiles.map(file => `${pythonValidationPip} install -r ${shellQuote(path.basename(file))}`);
    const pyprojectPath = path.join(directory, 'pyproject.toml');
    const pyproject = await readOptionalFile(pyprojectPath);
    if (pyproject !== undefined && isPythonPackageProject(pyproject)) {
        const extras = findPythonValidationExtras(pyproject);
        commands.push(extras.length
            ? `${pythonValidationPip} install ${shellQuote(`.[${extras.join(',')}]`)}`
            : `${pythonValidationPip} install .`);
    }
    return commands;
}

function isPythonPackageProject(pyproject: string): boolean {
    return /^\s*\[(?:build-system|project|tool\.(?:hatch|pdm|poetry|setuptools))(?:\.|\])[^]*$/im.test(pyproject);
}

function findPythonValidationExtras(pyproject: string): string[] {
    const header = /^\s*\[project\.optional-dependencies\]\s*$/im.exec(pyproject);
    if (!header) {
        return [];
    }
    const remainder = pyproject.slice(header.index + header[0].length);
    const nextSectionIndex = /^\s*\[/m.exec(remainder)?.index ?? remainder.length;
    const section = remainder.slice(0, nextSectionIndex);
    const preferredGroups = new Set(['dev', 'test', 'tests', 'lint']);
    return [...section.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)]
        .map(match => match[1])
        .filter(group => preferredGroups.has(group.toLowerCase()))
        .sort();
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

async function readNodePackageInfo(workspace: string, file: string): Promise<NodePackageInfo> {
    const packageJson = JSON.parse(await fs.readFile(file, 'utf8')) as {
        scripts?: Record<string, string>;
        workspaces?: string[] | { packages?: string[] };
    };
    const directory = path.dirname(file);
    return {
        directory,
        relativeDirectory: path.relative(workspace, directory) || '.',
        scripts: packageJson.scripts ?? {},
        workspacePatterns: Array.isArray(packageJson.workspaces)
            ? packageJson.workspaces
            : packageJson.workspaces?.packages ?? [],
        hasPackageLock: await hasSibling(file, 'package-lock.json'),
    };
}

function findWorkspaceRoot(
    nodePackage: NodePackageInfo,
    candidates: NodePackageInfo[],
): NodePackageInfo | undefined {
    return candidates
        .filter(candidate => candidate !== nodePackage
            && candidate.workspacePatterns.length > 0
            && isWithinDirectory(nodePackage.directory, candidate.directory)
            && candidate.workspacePatterns.some(pattern =>
                workspacePatternMatches(path.relative(candidate.directory, nodePackage.directory), pattern)))
        .sort((left, right) => pathDepth(right.relativeDirectory) - pathDepth(left.relativeDirectory))[0];
}

function workspacePatternMatches(relativeDirectory: string, pattern: string): boolean {
    const candidate = relativeDirectory.split(path.sep).join('/');
    const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    let expression = '^';
    for (let index = 0; index < normalizedPattern.length; index++) {
        const character = normalizedPattern[index];
        if (character === '*' && normalizedPattern[index + 1] === '*') {
            expression += '.*';
            index++;
        } else if (character === '*') {
            expression += '[^/]*';
        } else if (character === '?') {
            expression += '[^/]';
        } else {
            expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
        }
    }
    return new RegExp(`${expression}$`).test(candidate);
}

function getRequestedNodeValidations(
    scenario: CorEvaluationScenario,
): { script: 'build' | 'test' | 'lint'; command: string; required: boolean }[] {
    const validations: { script: 'build' | 'test' | 'lint'; command: string; required: boolean }[] = [];
    if (scenario.validation.build) {
        validations.push({ script: 'build', command: 'npm run build', required: true });
    }
    if (scenario.validation.test) {
        validations.push({ script: 'test', command: 'npm test', required: true });
    }
    if (scenario.validation.lint !== 'skip') {
        validations.push({
            script: 'lint',
            command: 'npm run lint',
            required: scenario.validation.lint === 'required',
        });
    }
    return validations;
}

function createTarget(
    ecosystem: ValidationEcosystem,
    workspace: string,
    directory: string,
    commands: string[],
): ProjectValidationTarget {
    return {
        ecosystem,
        relativeDirectory: path.relative(workspace, directory) || '.',
        commands,
    };
}

async function listProjectFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
            continue;
        }
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listProjectFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

async function hasSibling(file: string, siblingName: string): Promise<boolean> {
    try {
        await fs.access(path.join(path.dirname(file), siblingName));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

function missingScriptCommand(script: string): string {
    return `node -e "console.error('Missing required npm script: ${script}'); process.exit(1)"`;
}

function missingPythonLintCommand(): string {
    return `${pythonValidationInterpreter} -c "import sys; print('Missing required Python lint configuration', file=sys.stderr); sys.exit(1)"`;
}

async function detectPythonLintCommand(directory: string): Promise<string | undefined> {
    const ruffFiles = ['ruff.toml', '.ruff.toml'];
    if (await anyFileExists(directory, ruffFiles)) {
        return `${pythonValidationInterpreter} -m ruff check .`;
    }
    const pyproject = await readOptionalFile(path.join(directory, 'pyproject.toml'));
    const requirementNames = (await fs.readdir(directory))
        .filter(name => /^requirements(?:[-_.](?:dev|test|tests|lint))?\.txt$/i.test(name));
    const requirements = (await Promise.all(
        requirementNames.map(name => fs.readFile(path.join(directory, name), 'utf8')),
    )).join('\n');
    if (/\[tool\.ruff(?:\.|\])/.test(pyproject ?? '') || /^\s*ruff(?:[<=>~!].*)?$/im.test(requirements ?? '')) {
        return `${pythonValidationInterpreter} -m ruff check .`;
    }
    const setupConfig = await readOptionalFile(path.join(directory, 'setup.cfg'));
    if (await anyFileExists(directory, ['.flake8'])
        || /^\s*\[flake8\]\s*$/im.test(setupConfig ?? '')
        || /^\s*flake8(?:[<=>~!].*)?$/im.test(requirements ?? '')) {
        return `${pythonValidationInterpreter} -m flake8 .`;
    }
    return undefined;
}

async function hasDotnetLintConfiguration(directory: string): Promise<boolean> {
    return await anyFileExists(directory, [
        '.editorconfig',
        path.join('.config', 'dotnet-tools.json'),
    ]);
}

async function anyFileExists(directory: string, names: string[]): Promise<boolean> {
    for (const name of names) {
        try {
            await fs.access(path.join(directory, name));
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return false;
}

async function readOptionalFile(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

function isWithinDirectory(candidate: string, parent: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathDepth(relativeDirectory: string): number {
    return relativeDirectory === '.' ? 0 : relativeDirectory.split(path.sep).length;
}

function groupTargets(
    targets: ProjectValidationTarget[],
): Map<ValidationEcosystem, ProjectValidationTarget[]> {
    const groups = new Map<ValidationEcosystem, ProjectValidationTarget[]>();
    for (const target of targets) {
        const group = groups.get(target.ecosystem) ?? [];
        group.push(target);
        groups.set(target.ecosystem, group);
    }
    return groups;
}

function getToolchainCheckCommand(ecosystem: ValidationEcosystem): string {
    switch (ecosystem) {
        case 'node':
            return 'node --version && npm --version';
        case 'python':
            return 'python --version && python -m pip --version';
        case 'dotnet':
            return 'dotnet --info && test -n "$(dotnet --list-sdks)"';
    }
}

export async function createWorkspaceArchive(workspace: string, archivePath: string): Promise<void> {
    await execFileAsync('tar', [
        '-czf', archivePath,
        '--exclude=.git',
        '--exclude=.DS_Store',
        '--exclude=._*',
        '--exclude=*/._*',
        '--exclude=node_modules',
        '--exclude=dist',
        '--exclude=out',
        '-C', workspace,
        '.',
    ], {
        env: {
            ...process.env,
            ['COPYFILE_DISABLE']: '1',
        },
        maxBuffer: 10 * 1024 * 1024,
    });
}

export async function createSandboxManifest(
    sourcePath: string,
    destinationPath: string,
    runLabel: string,
): Promise<void> {
    const source = await fs.readFile(sourcePath, 'utf8');
    if (!/^labels:\s*$/m.test(source)) {
        throw new Error(`Sandbox manifest does not define labels: ${sourcePath}`);
    }
    const ownerLabel = process.env.COR_EVAL_OWNER_ID;
    if (ownerLabel !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(ownerLabel)) {
        throw new Error('COR_EVAL_OWNER_ID must be a lowercase alphanumeric/hyphen ACA label value.');
    }
    const labels = [
        `  run-id: ${runLabel}`,
        ...(ownerLabel ? [`  owner-id: ${ownerLabel}`] : []),
    ].join('\n');
    const content = source.replace(/^labels:\s*$/m, `labels:\n${labels}`);
    await fs.writeFile(destinationPath, content);
}

export function readSandboxId(stdout: string): string {
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
        try {
            const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as { id?: unknown };
            if (typeof parsed.id === 'string' && parsed.id) {
                return parsed.id;
            }
        } catch {
            // Fall through to the CLI's human-readable "Created sandbox <id>" output.
        }
    }
    const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    const id = new RegExp(`\\bCreated sandbox\\b[^\\r\\n]*?\\b(${uuidPattern})\\b`, 'i').exec(stdout)?.[1]
        ?? new RegExp(`^\\s*(${uuidPattern})\\s*$`, 'i').exec(stdout)?.[1];
    if (!id) {
        throw new Error('ACA sandbox apply did not return an id.');
    }
    return id;
}

export function readSandboxIds(stdout: string): string[] {
    const jsonStart = stdout.indexOf('[');
    const jsonEnd = stdout.lastIndexOf(']');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
        throw new Error('ACA sandbox list did not return a JSON array.');
    }
    const parsed: unknown = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) {
        throw new Error('ACA sandbox list did not return a JSON array.');
    }
    return parsed.flatMap(value => {
        if (!value || typeof value !== 'object') {
            return [];
        }
        const id = (value as { id?: unknown }).id;
        return typeof id === 'string' && id ? [id] : [];
    });
}

function tryReadSandboxId(stdout: string): string | undefined {
    try {
        return readSandboxId(stdout);
    } catch {
        return undefined;
    }
}

function toSandboxPath(relativeDirectory: string): string {
    const normalized = relativeDirectory.split(path.sep).join('/');
    return normalized === '.' ? '/workspace' : `/workspace/${normalized}`;
}

function truncate(value: string): string {
    return value.length <= maxLogLength ? value : `${value.slice(0, maxLogLength)}\n[truncated]`;
}

function removeRemoteExitMarker(value: string, marker: string): { output: string; exitCode?: number } {
    let exitCode: number | undefined;
    const output = value
        .split(/\r?\n/u)
        .filter(line => {
            if (line.startsWith(marker) && /^\d+$/u.test(line.slice(marker.length))) {
                exitCode = Number.parseInt(line.slice(marker.length), 10);
                return false;
            }
            return true;
        })
        .join('\n');
    return { output, exitCode };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class DefaultAcaCommandRunner implements AcaCommandRunner {
    public async run(args: string[], timeoutMs: number): Promise<AcaCommandResult> {
        return await execFileAsync('aca', args, {
            timeout: timeoutMs,
            maxBuffer: 20 * 1024 * 1024,
            encoding: 'utf8',
        });
    }
}
