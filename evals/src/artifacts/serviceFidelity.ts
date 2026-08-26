/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Does the scaffold contain the services the plan promised — and only those?
 *
 * Every other scaffold gate grades the tree against itself: it builds, the frontend is
 * embeddable, the API seam holds. All of them pass a project that dropped a service, because
 * two working services look exactly like two working services. The plan is the only artifact
 * that knows there should have been three.
 *
 * ## Matching is by role, not by name
 *
 * The plan names services freely — `Backend`, `API`, `Support API`, `Ticket Service` — while
 * the tree names directories by convention (`services/api`). Matching those by string is a
 * guessing game that fails on the agent's first reasonable naming choice and reports a
 * correct scaffold as missing a service. Role (`backend` / `frontend` / `worker`) is derived
 * on both sides from evidence, and a name similarity is used only to break ties when several
 * services share a role.
 *
 * ## Both directions
 *
 * A dropped service and an invented one are different failures with the same cause, and only
 * checking the first would let an agent satisfy the gate by scaffolding everything it could
 * think of. Library packages (`services/shared` and friends) are excluded from the invented
 * side: they are not deployable services and no plan lists them.
 *
 * Stack coverage matches `scaffoldTree.ts`. Language checks work anywhere a file extension
 * identifies a language; framework checks are Node-only today and are skipped — never
 * passed — elsewhere.
 */

import * as path from 'node:path';
import { discoverFrontendDirectory } from './frontendScaffold.ts';
import type { PlannedProject, PlannedService, PlannedServiceRole } from './plannedProject.ts';
import { readPlannedProject } from './plannedProject.ts';
import type { ScaffoldTree } from './scaffoldTree.ts';
import { LANGUAGE_EXTENSIONS, scanScaffoldTree } from './scaffoldTree.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

/** Directory names that are shared libraries rather than deployable services. */
const LIBRARY_NAMES = new Set([
    'shared', 'common', 'types', 'lib', 'libs', 'core', 'utils', 'models', 'contracts', 'sdk', 'config',
]);

/** Framework names the plan may choose, mapped to the package that proves them. */
const FRAMEWORK_PACKAGES: Record<string, string> = {
    react: 'react',
    vue: 'vue',
    angular: '@angular/core',
    svelte: 'svelte',
    solid: 'solid-js',
    next: 'next',
    'next.js': 'next',
    nuxt: 'nuxt',
    vite: 'vite',
    remix: '@remix-run/react',
    astro: 'astro',
};

interface ActualService {
    /** Workspace-relative directory, or `.` for a single-service repository. */
    directory: string;
    name: string;
    role: PlannedServiceRole | 'library';
}

export async function validateServiceFidelity(
    workspaceRoot: string,
    planMarkdown: string,
): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];
    const plan = readPlannedProject(planMarkdown);
    const tree = await scanScaffoldTree(workspaceRoot);

    const notApplicable = describeUnanalysableTree(tree);
    if (notApplicable) {
        return createValidationResult([notApplicable]);
    }

    if (plan.services.length === 0) {
        // Not a silent skip: a plan with no service sections cannot be compared to anything,
        // and treating "nothing promised" as "everything delivered" is how a gate ends up
        // green for every malformed plan it was built to catch.
        return createValidationResult([issue(
            'planDeclaresNoServices',
            '$.services',
            'The plan declares no services — expected one "## N. <Service> — <role>" section per service, each with a Language row.',
        )]);
    }

    if (tree.manifests.length === 0) {
        // Reachable only because `.azure/project-plan.md` was read from this same workspace,
        // so the tree is staged and really does contain no project. A plan promising services
        // over an empty tree is the most extreme form of the failure this gate exists for,
        // and must be a product failure rather than a not-applicable shrug.
        return createValidationResult([issue(
            'noServicesScaffolded',
            '.',
            `The plan declares ${plan.services.length} service(s), but the workspace contains no project manifest of any recognised ecosystem.`,
        )]);
    }

    const actual = await discoverActualServices(workspaceRoot, tree);
    // Union of two detectors on purpose. `discoverFrontendDirectory` is shared with the
    // frontend-scaffold and build gates, so the three always agree about *which* directory is
    // the frontend — but it only searches the root and the conventional group folders, so a
    // sanctioned flat layout (`frontend/` at the root) is invisible to it. Falling back to
    // this file's own role classification stops that layout being reported as a missing UI.
    const frontendDirectory = await discoverFrontendDirectory(workspaceRoot);
    const frontendService = actual.find(service => service.role === 'frontend');
    const frontendLocation = frontendDirectory
        ? relative(workspaceRoot, frontendDirectory)
        : frontendService?.directory;

    checkFrontendIntent(plan, frontendLocation, issues);
    const pairs = matchServices(plan.services, actual, workspaceRoot, frontendDirectory, issues);
    for (const pair of pairs) {
        checkLanguage(pair.planned, pair.actual, tree, issues);
        checkFramework(pair.planned, pair.actual, tree, issues);
    }

    return createValidationResult(issues);
}

/**
 * Report a tree this gate cannot see all of.
 *
 * A single unsupported manifest anywhere is enough to stop, even when other services are in
 * covered ecosystems. A Go service is invisible to `discoverActualServices` (its `go.mod` is
 * not in `tree.manifests`) and its imports are invisible to dependency analysis, so a mixed
 * repo would otherwise report the Go service as missing and its datastore as unwired — the
 * harness blaming the agent for a gap in the harness. Refusing to answer for the whole tree
 * is blunt, but a partially-blind gate that reports confident failures is worse than one
 * that says it cannot see.
 */
function describeUnanalysableTree(tree: ScaffoldTree): ArtifactValidationIssue | undefined {
    if (tree.unsupported.length === 0) {
        return undefined;
    }
    const languages = [...new Set(tree.unsupported.map(entry => entry.language))].join(', ');
    return issue('ecosystemNotSupported', tree.unsupported[0].file,
        `The tree contains ${languages} manifests, which no analyser covers yet; the rest of the tree cannot be graded without them.`);
}

/**
 * Compare the plan's frontend intent with the tree, in both directions.
 *
 * `App Type` is the plan's own statement of intent and is used when present. When it is
 * absent the presence of a frontend stack section stands in — rather than defaulting to
 * "no frontend expected", which would silently excuse a missing UI on every plan whose
 * overview lost a row.
 */
function checkFrontendIntent(
    plan: PlannedProject,
    frontendLocation: string | undefined,
    issues: ArtifactValidationIssue[],
): void {
    const planHasFrontendSection = plan.services.some(service => service.role === 'frontend');
    const expectsFrontend = plan.expectsFrontend ?? planHasFrontendSection;

    if (expectsFrontend && !frontendLocation) {
        issues.push(issue('frontendMissingFromScaffold', 'services/web',
            `The plan's App Type "${plan.appType ?? 'unspecified'}" promises a browser UI, but no frontend project was scaffolded.`));
    }
    if (!expectsFrontend && frontendLocation) {
        issues.push(issue('frontendNotPlanned', frontendLocation,
            `A frontend was scaffolded at ${frontendLocation}, but the plan's App Type "${plan.appType ?? 'unspecified'}" describes a project with no UI.`));
    }
    if (plan.expectsFrontend === true && !planHasFrontendSection) {
        issues.push(issue('plannedFrontendSectionMissing', '$.services',
            `App Type "${plan.appType}" implies a UI, but the plan has no frontend service section.`));
    }
    if (plan.expectsFrontend === false && planHasFrontendSection) {
        issues.push(issue('unexpectedFrontendSection', '$.services',
            `App Type "${plan.appType}" describes a project with no UI, but the plan declares a frontend service.`));
    }
}

interface ServicePair {
    planned: PlannedService;
    actual: ActualService;
}

/**
 * Pair planned services with scaffolded directories, reporting whatever is left over on
 * either side. Matching prefers same-role candidates and falls back to any unclaimed
 * directory.
 *
 * The fallback is what keeps role classification from manufacturing failures. Roles are
 * inferred from directory names and file evidence, which is right most of the time and
 * confidently wrong the rest — rename `services/worker` to `services/notifications` and it
 * reads as a backend. Without the fallback that single misread produces *two* failures on a
 * correct project: the planned worker looks missing and the directory looks invented. So a
 * count mismatch is reported and a role disagreement is not: surplus and shortfall are facts
 * about the tree, whereas a role is this file's opinion about it.
 */
function matchServices(
    planned: PlannedService[],
    actual: ActualService[],
    workspaceRoot: string,
    frontendDirectory: string | undefined,
    issues: ArtifactValidationIssue[],
): ServicePair[] {
    const unclaimed = actual.filter(service => service.role !== 'library');
    const pairs: ServicePair[] = [];

    for (const service of planned) {
        const sameRole = unclaimed.filter(candidate => candidate.role === service.role);
        const pool = sameRole.length > 0 ? sameRole : unclaimed;
        const chosen = [...pool].sort((left, right) => similarity(right.name, service.name) - similarity(left.name, service.name))[0];
        if (!chosen) {
            issues.push(issue('plannedServiceMissing', '$.services',
                `The plan declares "${service.heading}" (${service.role}), but only ${actual.filter(value => value.role !== 'library').length} service director(ies) were scaffolded.`));
            continue;
        }
        unclaimed.splice(unclaimed.indexOf(chosen), 1);
        pairs.push({ planned: service, actual: chosen });
    }

    for (const leftover of unclaimed) {
        // The discovered frontend is never "invented": a plan that promises a UI without a
        // frontend stack section is already reported as `plannedFrontendSectionMissing`, and
        // reporting the same plan defect twice, once as an invented service, is noise.
        if (frontendDirectory && path.resolve(workspaceRoot, leftover.directory) === frontendDirectory) {
            continue;
        }
        issues.push(issue('unplannedServiceScaffolded', leftover.directory,
            `${leftover.directory} looks like a deployable ${leftover.role} service, but the plan never declares it.`));
    }

    return pairs;
}

function checkLanguage(
    planned: PlannedService,
    actual: ActualService,
    tree: ScaffoldTree,
    issues: ArtifactValidationIssue[],
): void {
    const expected = LANGUAGE_EXTENSIONS[(planned.language ?? '').trim().toLowerCase()];
    if (!expected) {
        return;
    }
    const files = filesUnder(tree, actual.directory);
    if (files.some(file => expected.includes(path.extname(file).toLowerCase()))) {
        return;
    }
    const found = [...new Set(files
        .map(file => languageForExtension(path.extname(file).toLowerCase()))
        .filter((language): language is string => !!language))];
    if (found.length === 0) {
        // No source in a recognised language at all: say nothing rather than guess. An empty
        // or asset-only directory is a different failure, and `plannedServiceMissing` or the
        // build gate is the honest place for it.
        return;
    }
    issues.push(issue('serviceLanguageMismatch', actual.directory,
        `The plan builds "${planned.heading}" in ${planned.language}, but ${actual.directory} contains ${found.join(', ')} source.`));
}

function checkFramework(
    planned: PlannedService,
    actual: ActualService,
    tree: ScaffoldTree,
    issues: ArtifactValidationIssue[],
): void {
    if (!planned.framework) {
        return;
    }
    const expected = planned.framework
        .split(/[+,/]|\s+and\s+/)
        .map(token => FRAMEWORK_PACKAGES[token.trim().toLowerCase()])
        .filter((packageName): packageName is string => !!packageName);
    if (expected.length === 0) {
        return;
    }
    // Framework detection reads Node manifests, so a non-Node service is skipped rather than
    // passed — an unchecked property must never be reported as a satisfied one.
    const manifests = tree.dependencies.filter(dependency =>
        dependency.ecosystem === 'node' && isUnder(dependency.manifest, actual.directory));
    if (manifests.length === 0) {
        return;
    }
    const declared = new Set(manifests.map(dependency => dependency.name));
    const missing = expected.filter(packageName => !declared.has(packageName));
    if (missing.length > 0) {
        issues.push(issue('serviceFrameworkMismatch', actual.directory,
            `The plan builds "${planned.heading}" with ${planned.framework}, but ${actual.directory} declares no ${missing.join(', ')}.`));
    }
}

/**
 * Candidate service directories are derived from where manifests actually are, not from a
 * fixed list of group folders.
 *
 * The scaffold agent's own instructions say paths are examples and an existing workspace
 * layout wins, so `backend/`, `frontend/`, `worker/` at the root is a sanctioned outcome. A
 * `services/`-only search reports every one of those as missing — the gate failing a project
 * for following its instructions.
 */
async function discoverActualServices(workspaceRoot: string, tree: ScaffoldTree): Promise<ActualService[]> {
    const manifestDirectories = [...new Set(tree.manifests.map(manifest => {
        const directory = path.posix.dirname(manifest);
        return directory === '' ? '.' : directory;
    }))];

    // A root manifest alongside others is the monorepo workspace root, not a service of its
    // own; and a manifest nested inside another candidate belongs to that candidate.
    const roots = manifestDirectories.filter(candidate =>
        !(candidate === '.' && manifestDirectories.length > 1)
        && !manifestDirectories.some(other => other !== candidate && other !== '.' && isUnder(candidate, other)));

    const services: ActualService[] = [];
    for (const directory of roots) {
        const name = directory === '.' ? path.basename(workspaceRoot) : path.posix.basename(directory);
        services.push({ directory, name, role: classifyRole(name, directory, tree) });
    }
    return services;
}

function classifyRole(name: string, directory: string, tree: ScaffoldTree): PlannedServiceRole | 'library' {
    if (LIBRARY_NAMES.has(name.toLowerCase())) {
        return 'library';
    }
    const files = filesUnder(tree, directory);
    // Reuse the frontend scorer rather than testing for index.html: it understands Next and
    // Angular layouts that have no index.html, and having two disagreeing notions of "this is
    // the frontend" inside one file is how a correct Next.js app gets reported as missing.
    if (looksLikeFrontend(directory, tree)) {
        return 'frontend';
    }
    if (/\b(worker|jobs?|background|queue|processor|scheduler|consumer)\b/i.test(name)) {
        return 'worker';
    }
    // Trigger bindings are the strongest available evidence of a worker: an HTTP-only service
    // and a queue-consuming one are otherwise identical from the outside.
    const hasTriggerBinding = files.some(file => {
        const content = tree.fileContents.get(file);
        return !!content && /(queueTrigger|timerTrigger|serviceBusTrigger|blobTrigger|app\.(?:timer|queue|service_bus))/i.test(content);
    });
    if (hasTriggerBinding) {
        return 'worker';
    }
    if (/\b(api|backend|server|service|functions?)\b/i.test(name)) {
        return 'backend';
    }
    // No positive evidence. `unknown` matches anything during pairing, which is the right
    // outcome — an unrecognised name is not grounds for declaring a service missing.
    return 'unknown';
}

/** Browser-project evidence: a loadable HTML entry point or a frontend framework dependency. */
function looksLikeFrontend(directory: string, tree: ScaffoldTree): boolean {
    const files = filesUnder(tree, directory);
    if (files.some(file => /(^|\/)(index\.html|app\/page\.(t|j)sx?)$/i.test(file))) {
        return true;
    }
    const frameworks = new Set(['react', 'react-dom', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'astro']);
    return tree.dependencies.some(dependency =>
        dependency.ecosystem === 'node' && isUnder(dependency.manifest, directory) && frameworks.has(dependency.name));
}

function filesUnder(tree: ScaffoldTree, directory: string): string[] {
    return tree.files.filter(file => isUnder(file, directory));
}

function isUnder(file: string, directory: string): boolean {
    return directory === '.' ? true : file === directory || file.startsWith(`${directory}/`);
}

function languageForExtension(extension: string): string | undefined {
    return Object.entries(LANGUAGE_EXTENSIONS).find(([, extensions]) => extensions.includes(extension))?.[0];
}

/** Crude token overlap, used only to break ties between same-role candidates. */
function similarity(left: string, right: string): number {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    if (a === b) {
        return 3;
    }
    return a.includes(b) || b.includes(a) ? 2 : 0;
}

function relative(workspaceRoot: string, target: string): string {
    return path.relative(workspaceRoot, target).split(path.sep).join('/') || '.';
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}
