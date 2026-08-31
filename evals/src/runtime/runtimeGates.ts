/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The gates that run the product instead of reading it.
 *
 * Every other validator in `../artifacts` answers a question about a file. These five ask
 * the application itself, which is the difference between "it compiles" and "it works": a
 * scaffold with a plausible `package.json`, a well-formed `launch.json` and a server that
 * throws on its first line passes every file-reading gate we have.
 *
 * Two conventions hold throughout, and both exist because of PR #1669's `gateHealth`
 * finding — a gate that was 0-for-16 across every run ever executed, because its own probe
 * was broken and "couldn't connect" looks identical whether the app is broken or the prober
 * is:
 *
 *   1. **These validators never throw.** Grader certification runs a fixture's validators
 *      together, so a validator that threw on an unrelated mutation would take down the
 *      whole certification run rather than report anything.
 *
 *   2. **A harness fault and a not-applicable verdict are still recorded as issues**, on
 *      top of the flag the grader reads. The grader uses the flag to pick its exit code;
 *      certification only sees issues, so the golden fixture goes *red* if a gate cannot
 *      run or decides it has no opinion. That is deliberate: it means the certified claim
 *      is "this gate substantively ran against a real app and passed", not "this gate
 *      declined to look and reported nothing". A gate that quietly stops testing anything
 *      is the failure mode this whole file is built to avoid.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { discoverFrontendDirectory } from '../artifacts/frontendScaffold.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from '../artifacts/validationTypes.ts';
import { declaresBackendContract, type NotApplicableReason } from './runtimeTarget.ts';
import { canConnect } from './appProcess.ts';
import { acquireRuntimeSession, probe, type HttpProbeResponse, type RuntimeSession } from './runtimeSession.ts';

export interface RuntimeValidationResult extends ArtifactValidationResult {
    /** Set when the grader itself could not run — maps to exit 3, never blamed on the agent. */
    harnessFault?: string;
    /**
     * Set when an input this gate consumes was never produced upstream. Distinct from a
     * harness fault: nothing is broken here, the gate simply never got its input, and the
     * gate that owns producing it reports the failure.
     */
    notAttempted?: { precondition: string; detail: string };
    /** Set when this gate has no opinion about this stack — maps to the NOT_APPLICABLE marker. */
    notApplicable?: { reason: NotApplicableReason; detail: string };
    /** Context worth printing whatever the verdict is. */
    diagnostics: string[];
}

/** Health paths tried only when the project declared none of its own. */
const CONVENTIONAL_HEALTH_PATHS = ['/api/health', '/health', '/healthz', '/api/healthz', '/api/status', '/status', '/ping'];

/**
 * Datastore clients that need a server this process did not start.
 *
 * The name says "container" because that is where the reason code came from, and the reason
 * code is load-bearing: stacks declare known gaps against `datastoreRequiresContainer` by
 * name, so renaming it would silently invalidate those declarations. What the list actually
 * means is "persists through something that has to be listening", which is now broader than
 * Docker — the Azure Storage clients talk to Azurite, which is a Node process.
 *
 * The Azure entries matter for attribution more than for coverage. Before they were here,
 * `@azure/storage-blob` matched nothing, so a blob-backed project skipped the stand-down
 * entirely and went straight to the round-trip. With Azurite up that happens to work; with
 * Azurite down the app fails and the gate reports the *product* as broken, which is the one
 * outcome this file exists to prevent.
 */
const CONTAINER_DATASTORE_PACKAGES = [
    'pg', 'postgres', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'redis', 'ioredis', 'mssql', 'cassandra-driver',
    '@azure/storage-blob', '@azure/storage-queue', '@azure/data-tables',
];

/**
 * Default ports for the clients above, so "needs a server" can be checked rather than assumed.
 *
 * The stand-down these feed used to fire on the *package name alone*, which was right for as
 * long as a server was impossible: no Docker meant no database, so `pg` in the dependencies
 * settled it. That reasoning outlived its premise. The custom image installs PostgreSQL and
 * Azurite — neither needs a container — and the phase preamble starts them, so the honest
 * question became "is anything listening?" rather than "is `pg` in package.json?".
 *
 * Getting this wrong is expensive in the invisible direction: a gate that stands down when
 * the service is up reports `datastoreRequiresContainer` forever and looks exactly like a
 * correctly-declared known gap, which is why `runtime-crud` sat at 0 passes without anyone
 * asking whether the reason still held.
 */
const DATASTORE_DEFAULT_PORTS: Record<string, number> = {
    pg: 5432,
    postgres: 5432,
    mysql: 3306,
    mysql2: 3306,
    mongodb: 27017,
    mongoose: 27017,
    redis: 6379,
    ioredis: 6379,
    mssql: 1433,
    'cassandra-driver': 9042,
    // Azurite's defaults. Three ports rather than one because a project using only queues
    // would otherwise be judged by whether the blob service happened to be up.
    '@azure/storage-blob': 10000,
    '@azure/storage-queue': 10001,
    '@azure/data-tables': 10002,
};

/**
 * Whether the datastore this project needs is actually listening.
 *
 * A TCP connect, not a query: the credentials and database name belong to the app, and this
 * only has to answer whether standing down is still honest. A false positive here costs a
 * real CRUD attempt that fails loudly; a false negative costs a permanent silent skip, which
 * is the worse direction.
 */
async function datastoreServerReachable(datastore: string): Promise<boolean> {
    const port = DATASTORE_DEFAULT_PORTS[datastore];
    if (port === undefined) {
        return false;
    }
    return await canConnect(port);
}

/**
 * **The attribution rule.** Stated once here because every gate in this file needs it and
 * three sessions have now independently re-derived it, once per gate, at the cost of a
 * silent pass each time.
 *
 * When a gate looks for a capability and does not find it, there are three different
 * situations behind that one observation, and they take three different exit codes:
 *
 *   1. **We could not read well enough to tell** → *harness fault*, exit 3. Our parser's
 *      limitation is never the agent's defect. This case is the one that gets forgotten,
 *      because from the outside it looks exactly like the capability being absent.
 *   2. **Contract evidence says the product owed this, and it is absent** → *product
 *      failure*, exit 1. A real, reportable defect.
 *   3. **No contract evidence either way** → *not applicable*. We have a real question and
 *      nothing to check it against; that is a coverage gap, not a clean bill of health.
 *
 * Order matters: (1) is checked first, because a parser that cannot read the frontend
 * produces the same emptiness as a frontend that does nothing, and reporting the second
 * when the first is true manufactures a failure — or, as it did here three times, a silent
 * pass. "Nothing found" is only evidence once you know you could have found something.
 */
type AbsenceAttribution = 'cannotTell' | 'productOwedIt' | 'noContract';

function attributeAbsence(evidence: { couldNotRead: boolean; contractDeclared: boolean }): AbsenceAttribution {
    if (evidence.couldNotRead) {
        return 'cannotTell';
    }
    return evidence.contractDeclared ? 'productOwedIt' : 'noContract';
}

/** Static roots an app-served frontend is normally read from. */
const STATIC_ROOTS = ['public', 'wwwroot', 'static', 'client', 'dist', '.'];

// ---------------------------------------------------------------------------------------
// Gate 1 — the app starts
// ---------------------------------------------------------------------------------------

/**
 * The most basic runtime claim there is: the thing boots and listens.
 *
 * `validate-project-builds` already proves it compiles, and a project that builds cleanly
 * and dies on its first line is a real, common failure that every existing gate passes.
 */
export async function validateAppStarts(workspaceRoot: string): Promise<RuntimeValidationResult> {
    const session = await acquireRuntimeSession(workspaceRoot);
    // The only caller passing ownsStartup. This gate exists to answer "does it start?", so a
    // startup failure is its finding to report; the other four defer to it rather than each
    // re-reporting the same corpse.
    const blocked = describeUnusableSession(session, { ownsStartup: true });
    if (blocked) {
        return blocked;
    }
    const { app, target } = session as Extract<RuntimeSession, { kind: 'started' }>;
    return pass([
        `started with "${[target.command, ...target.args].join(' ')}" in ${target.cwd} (${target.startSource})`,
        app.baseUrl === undefined
            // The stack declares no API, so "it listened" was never the right assertion.
            // What was checked is that the process was still running after a settling
            // window — falsifiable, and failed by a worker that exits on startup.
            ? 'no HTTP surface declared (project.api: none); still running after the liveness window'
            : `listening on ${app.baseUrl} (port ${app.portProvenance})`,
        ...app.findings.map(finding => `finding [${finding.code}]: ${finding.message}`),
    ]);
}

// ---------------------------------------------------------------------------------------
// Gate 2 — a health endpoint responds
// ---------------------------------------------------------------------------------------

export interface HealthOptions {
    /** Fail instead of returning not-applicable when no health endpoint can be found. */
    requireHealth?: boolean;
}

/**
 * "It's alive" — the signal every deployment probe depends on.
 *
 * A *declared* health path that does not answer is an unambiguous product failure: the
 * project committed to it in its own integration plan, API test collection or debug plan.
 *
 * When nothing is declared, conventional paths are tried — and a total miss is **not**
 * out-of-scope. By the time this runs the app is up and answering HTTP, so seven misses on
 * a live server is positive evidence that no health endpoint was built, not an absence of
 * anything to test. Whether that is the *product's* fault turns on whether it owed one:
 * `.azure/integration-plan.md` is the hand-off artifact the scaffold agent must write, and
 * `validateIntegrationPlanArtifact` already fails the agent when its Backend section names
 * no health endpoint path. So its presence makes this a contract the product did not meet —
 * exit 1 — and its absence leaves a gap we cannot attribute, which is a `coverageGap`
 * rather than a shrug.
 *
 * This originally returned not-applicable in every no-declaration case, which made the gate
 * unable to fail for the one thing it exists to check: a running app with no health
 * endpoint scored green. That is the same defect as the retired `noProjectManifestFound` —
 * a product failure wearing a not-applicable costume — and it survived the review that
 * caught the other one.
 */
export async function validateHealthEndpoint(workspaceRoot: string, options: HealthOptions = {}): Promise<RuntimeValidationResult> {
    const session = await acquireRuntimeSession(workspaceRoot);
    const blocked = describeUnusableSession(session);
    if (blocked) {
        return blocked;
    }
    const { app, target } = session as Extract<RuntimeSession, { kind: 'started' }>;
    const httpSurface = requireHttpSurface(session);
    if (typeof httpSurface !== 'string') {
        return httpSurface;
    }
    const baseUrl = httpSurface;


    if (target.healthPath) {
        const result = await probe(`${baseUrl}${target.healthPath}`);
        if (!result.ok) {
            return failure(
                'healthEndpointUnreachable',
                target.healthPath,
                `the app is listening on ${baseUrl} but the health endpoint ${target.healthPath} `
                + `(declared in ${describeHealthSource(target.healthPathSource)}) could not be reached: ${result.error}.`,
                app.output(),
            );
        }
        if (!isSuccess(result.response.status)) {
            return failure(
                'healthEndpointUnhealthy',
                target.healthPath,
                `the health endpoint ${target.healthPath} (declared in ${describeHealthSource(target.healthPathSource)}) `
                + `returned ${result.response.status}: ${excerpt(result.response.body)}`,
                app.output(),
            );
        }
        return pass([`${target.healthPath} → ${result.response.status} (declared in ${describeHealthSource(target.healthPathSource)})`]);
    }

    const attempts: string[] = [];
    for (const candidate of CONVENTIONAL_HEALTH_PATHS) {
        const result = await probe(`${baseUrl}${candidate}`);
        if (result.ok && isSuccess(result.response.status)) {
            return pass([`${candidate} → ${result.response.status} (guessed; the project declared no health path)`]);
        }
        attempts.push(`${candidate} → ${result.ok ? String(result.response.status) : result.error}`);
    }

    if (options.requireHealth) {
        return failure(
            'healthEndpointMissing',
            '$.health',
            `the app is listening on ${baseUrl} but no health endpoint answered. Tried: ${attempts.join(', ')}.`,
            app.output(),
        );
    }

    // The app is up and answering HTTP, and nothing at seven conventional paths responded.
    // If it went through the scaffold flow it owed a health endpoint, so this is a contract
    // the product did not meet rather than a question we cannot answer.
    if (await declaresBackendContract(workspaceRoot)) {
        return failure(
            'healthEndpointMissing',
            '$.health',
            `the app is listening on ${baseUrl} but has no health endpoint: nothing is declared in its API test collections, `
            + '.azure/integration-plan.md or .azure/vscode-debug-plan.md, and no conventional path answered. '
            + `The project has an integration plan, whose Backend section is required to name a health endpoint path. Tried: ${attempts.join(', ')}.`,
            app.output(),
        );
    }
    return notApplicable(
        'noHealthPathDeclared',
        `the app is listening on ${baseUrl} but no health endpoint answered (tried ${attempts.join(', ')}), and the workspace `
        + 'has no .azure/integration-plan.md, so there is no record of it having promised one. The gate has a real question here '
        + 'and no contract to check it against; pass --require-health to fail instead.',
    );
}

// ---------------------------------------------------------------------------------------
// Gate 3 — the frontend serves
// ---------------------------------------------------------------------------------------

export interface FrontendOptions {
    /** Fail instead of returning not-applicable when no frontend is found. */
    requireFrontend?: boolean;
}

/**
 * The UI is actually delivered to a browser.
 *
 * Scoped to frontends the app under test serves itself. A frontend that lives in its own
 * package behind a dev server is a second process with its own install and its own
 * readiness signal; starting it is a real extension rather than a tweak, so for now that
 * shape returns not-applicable with its own reason code rather than pretending to cover it.
 */
export async function validateFrontendServes(workspaceRoot: string, options: FrontendOptions = {}): Promise<RuntimeValidationResult> {
    const session = await acquireRuntimeSession(workspaceRoot);
    const blocked = describeUnusableSession(session);
    if (blocked) {
        return blocked;
    }
    const { app, target } = session as Extract<RuntimeSession, { kind: 'started' }>;
    const httpSurface = requireHttpSurface(session);
    if (typeof httpSurface !== 'string') {
        return httpSurface;
    }
    const baseUrl = httpSurface;


    const separate = await discoverFrontendDirectory(workspaceRoot);
    if (separate && path.resolve(separate) !== path.resolve(target.packageDirectory)) {
        return notApplicable(
            'frontendDevServerUnsupported',
            `the frontend in ${path.relative(workspaceRoot, separate) || '.'} runs as its own dev server, which these gates do not start yet. `
            + 'Only frontends served by the application under test are probed.',
        );
    }

    if (!await hasServedMarkup(workspaceRoot) && !options.requireFrontend) {
        return notApplicable('noFrontendDeclared', 'the project serves no index.html, so it has no browser frontend to probe.');
    }

    const result = await probe(`${baseUrl}/`);
    if (!result.ok) {
        return failure('frontendUnreachable', '/', `the frontend at ${baseUrl}/ could not be reached: ${result.error}.`, app.output());
    }
    if (!isSuccess(result.response.status)) {
        return failure('frontendNotServed', '/', `the app returned ${result.response.status} for / instead of the frontend: ${excerpt(result.response.body)}`, app.output());
    }
    if (!looksLikeHtml(result.response)) {
        return failure(
            'frontendResponseNotHtml',
            '/',
            `the app answered / with ${result.response.contentType || 'no content type'} and ${result.response.body.length} bytes, `
            + `which is not a browser document: ${excerpt(result.response.body)}`,
            app.output(),
        );
    }
    return pass([`/ → ${result.response.status} ${result.response.contentType} (${result.response.body.length} bytes)`]);
}

// ---------------------------------------------------------------------------------------
// Gate 4 — the frontend and the backend are actually wired together
// ---------------------------------------------------------------------------------------

/**
 * Two halves that each work and never speak to each other is a classic scaffolding failure,
 * and every file-reading gate passes it: both packages build, both have plausible routes.
 *
 * The check is deliberately made against the *served* assets rather than the source tree,
 * because what the browser receives is what matters. Any same-origin path the frontend
 * calls must resolve on the running backend. Only a 404 counts as a failure — a 400, 405 or
 * 500 all prove the route exists, which is the question this gate asks.
 */
export async function validateFrontendApiWiring(workspaceRoot: string): Promise<RuntimeValidationResult> {
    const session = await acquireRuntimeSession(workspaceRoot);
    const blocked = describeUnusableSession(session);
    if (blocked) {
        return blocked;
    }
    const { app, target } = session as Extract<RuntimeSession, { kind: 'started' }>;
    const httpSurface = requireHttpSurface(session);
    if (typeof httpSurface !== 'string') {
        return httpSurface;
    }
    const baseUrl = httpSurface;


    const separate = await discoverFrontendDirectory(workspaceRoot);
    if (separate && path.resolve(separate) !== path.resolve(target.packageDirectory)) {
        return notApplicable(
            'frontendDevServerUnsupported',
            `the frontend in ${path.relative(workspaceRoot, separate) || '.'} runs as its own dev server, which these gates do not start yet.`,
        );
    }

    const document = await probe(`${baseUrl}/`);
    if (!document.ok || !isSuccess(document.response.status) || !looksLikeHtml(document.response)) {
        return notApplicable('noFrontendDeclared', 'the app serves no browser document at /, so there is no frontend wiring to check.');
    }

    const { calls, usesHttpClient } = await collectApiCalls(baseUrl, document.response.body);
    if (calls.length === 0) {
        switch (attributeAbsence({
            couldNotRead: usesHttpClient,
            contractDeclared: await declaresBackendContract(workspaceRoot),
        })) {
            case 'cannotTell':
                return harnessFault(
                    'the served frontend issues HTTP requests, but none of their URLs could be resolved statically — '
                    + 'a computed base (`fetch(`${base}/items`)`) or a client wrapper defeats the extraction. '
                    + 'This says nothing about whether the frontend is wired; it says this gate cannot read it.',
                    app.output(),
                    'frontendApiCallsUnresolvable',
                );
            case 'productOwedIt':
                // The failure this gate exists for, and the one it could not previously
                // report: an integration plan promising API routes, and a served frontend
                // that calls nothing at all.
                return failure(
                    'frontendMakesNoApiCalls',
                    '/',
                    `the served frontend at ${baseUrl}/ issues no HTTP requests whatsoever, while `
                    + '.azure/integration-plan.md declares the API routes it was supposed to call. '
                    + 'The two halves were built and never connected.',
                    app.output(),
                );
            case 'noContract':
                return notApplicable(
                    'noFrontendApiCalls',
                    'the served frontend issues no HTTP requests, and the workspace has no .azure/integration-plan.md '
                    + 'declaring routes it should have called, so there is no contract to hold it to.',
                );
        }
    }

    const issues: ArtifactValidationIssue[] = [];
    const checked: string[] = [];
    for (const call of calls) {
        const result = await probe(`${baseUrl}${call}`);
        if (!result.ok) {
            issues.push(issue('frontendApiRouteUnreachable', call, `the frontend calls ${call}, which could not be reached on the running backend: ${result.error}.`));
            continue;
        }
        if (result.response.status === 404) {
            issues.push(issue(
                'frontendApiRouteMissing',
                call,
                `the served frontend calls ${call}, but the running backend answers 404 for it — the two halves are not wired together.`,
            ));
            continue;
        }
        checked.push(`${call} → ${result.response.status}`);
    }
    return issues.length > 0
        ? withOutput({ valid: false, issues, diagnostics: checked }, app.output())
        : pass([`frontend calls resolve on the backend: ${checked.join(', ')}`]);
}

// ---------------------------------------------------------------------------------------
// Gate 5 — a CRUD round-trip persists
// ---------------------------------------------------------------------------------------

/**
 * Write something, read it back — the check that separates a working data layer from a
 * well-typed stub that returns `[]` and never stores anything.
 *
 * A stack whose datastore needs a server is reported not-applicable when nothing is
 * listening, rather than passed. A silent pass on a stack we cannot exercise is a gate
 * that has quietly stopped testing anything.
 *
 * What changed is which question decides that. It used to be "does package.json declare
 * `pg`?", on the reasoning that no Docker meant no database. The custom image now installs
 * PostgreSQL and Azurite — neither needs a container — and the phase preamble starts them,
 * so the question is now "is anything listening on the port?".
 *
 * Both directions are measured, in the container, by container/verify-emulators.sh:
 *
 *   postgres running  →  PASS, "POST then GET /api/items round-tripped"
 *   postgres stopped  →  NOT_APPLICABLE datastoreRequiresContainer, exit 3
 *
 * The second line is the one that makes the first worth anything. A gate that passes
 * because it never really talked to the database would pass identically in both runs.
 */
export async function validateCrudRoundTrip(workspaceRoot: string): Promise<RuntimeValidationResult> {
    const session = await acquireRuntimeSession(workspaceRoot);
    const blocked = describeUnusableSession(session);
    if (blocked) {
        return blocked;
    }
    const { app, target } = session as Extract<RuntimeSession, { kind: 'started' }>;
    const httpSurface = requireHttpSurface(session);
    if (typeof httpSurface !== 'string') {
        return httpSurface;
    }
    const baseUrl = httpSurface;


    const datastore = await findContainerDatastore(target.packageDirectory);
    if (datastore && !await datastoreServerReachable(datastore)) {
        return notApplicable(
            'datastoreRequiresContainer',
            `the project persists through "${datastore}", which needs a server, and nothing is listening on `
            + `port ${DATASTORE_DEFAULT_PORTS[datastore]}. The phase preamble starts PostgreSQL and Azurite in `
            + 'the custom image; on the stock image neither is installed, and a round-trip cannot be exercised '
            + 'honestly here. Nothing in this result is evidence about the generated app.',
        );
    }

    const document = await probe(`${baseUrl}/`);
    const servesFrontend = document.ok && looksLikeHtml(document.response);
    const extracted = servesFrontend
        ? await findCollectionEndpoint(baseUrl, document.response.body)
        : undefined;

    // Rung 0 for the route. The *fields* still come from the frontend, because the stack
    // schema declares a route but not a payload shape — and posting `{}` to a correctly
    // validating API earns a 400, which would be a fabricated product failure. So a
    // declared route with no readable payload is reported as our gap, not the product's.
    if (target.collectionRoute && !extracted) {
        return harnessFault(
            `the stack declares project.collectionRoute: ${target.collectionRoute}, but no request body shape could be `
            + 'extracted from the served frontend, so this gate cannot build a payload the API would accept. '
            + 'Declaring a payload shape alongside the route would close this.',
            app.output(),
            'collectionPayloadUnknown',
        );
    }
    const collection = target.collectionRoute && extracted
        ? { path: target.collectionRoute, fields: extracted.fields }
        : extracted;
    if (!collection) {
        // Same attribution rule as the wiring gate. A frontend that plainly posts, whose
        // URL or body shape we could not extract, is our limitation — and reporting it as
        // "this project has no CRUD" is how the gate quietly stopped testing anything.
        const { usesHttpClient } = servesFrontend
            ? await collectApiCalls(baseUrl, document.response.body)
            : { usesHttpClient: false };
        if (usesHttpClient) {
            return harnessFault(
                'the served frontend issues HTTP requests, but no collection endpoint could be extracted from them — '
                + 'a computed URL or a client wrapper defeats the extraction. Declare `project.collectionRoute` in the '
                + 'stack file to check this stack properly; this gate cannot read it unaided.',
                app.output(),
                'collectionRouteUnresolvable',
            );
        }
        return notApplicable(
            'noCollectionRouteDeclared',
            'the served frontend issues no HTTP requests at all, so no collection endpoint could be identified and '
            + 'there is no round-trip to attempt.',
        );
    }

    const marker = `cor-runtime-probe-${Math.random().toString(36).slice(2, 10)}`;
    const payload: Record<string, string> = {};
    for (const field of collection.fields) {
        payload[field] = marker;
    }

    const created = await probe(`${baseUrl}${collection.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!created.ok) {
        return failure('crudCreateUnreachable', collection.path, `POST ${collection.path} could not be reached: ${created.error}.`, app.output());
    }
    if (!isSuccess(created.response.status)) {
        return failure(
            'crudCreateRejected',
            collection.path,
            `POST ${collection.path} with ${JSON.stringify(payload)} returned ${created.response.status}: ${excerpt(created.response.body)}`,
            app.output(),
        );
    }

    const readBack = await probe(`${baseUrl}${collection.path}`);
    if (!readBack.ok) {
        return failure('crudReadUnreachable', collection.path, `GET ${collection.path} could not be reached after a successful create: ${readBack.error}.`, app.output());
    }
    if (!isSuccess(readBack.response.status)) {
        return failure('crudReadRejected', collection.path, `GET ${collection.path} returned ${readBack.response.status} after a successful create: ${excerpt(readBack.response.body)}`, app.output());
    }
    if (!readBack.response.body.includes(marker)) {
        return failure(
            'crudRoundTripLost',
            collection.path,
            `POST ${collection.path} reported ${created.response.status}, but the record is not in the collection when it is read back — `
            + `the data layer accepted the write and did not keep it. GET returned: ${excerpt(readBack.response.body)}`,
            app.output(),
        );
    }
    return pass([`POST then GET ${collection.path} round-tripped ${JSON.stringify(payload)}`]);
}

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

/**
 * Turn a session that never started into this gate's verdict.
 *
 * Every gate needs the app running, so they all share one mapping — and all of them report
 * the startup failure with the same code, so a broken app produces one obvious root cause
 * across the suite rather than five different-looking symptoms.
 */
/**
 * Gates 2-5 all probe over HTTP, so they all need the same guard: a background worker has
 * no surface to probe. This is the one genuinely out-of-scope case in the vocabulary —
 * nothing to look at, and no remedy would change that, because the stack declared the
 * project has no API. Gate 1 deliberately does not use this: for a worker it asserts
 * liveness instead, so the suite still has one gate that can fail.
 */
function requireHttpSurface(session: RuntimeSession): string | RuntimeValidationResult {
    const baseUrl = session.kind === 'started' ? session.app.baseUrl : undefined;
    return baseUrl ?? notApplicable(
        'noHttpSurface',
        'the stack declares project.api: none, so this project is a background worker with no HTTP surface to probe. '
        + 'runtime-app-starts still asserts it stays running.',
    );
}

/**
 * Turn a session that never became usable into this gate's verdict.
 *
 * `ownsStartup` decides the one interesting case. When the app fails to start, exactly one
 * gate should report a product failure — `runtime-app-starts`, which is the gate whose whole
 * question is "does it start?". The other four consume a running app they never got, and a
 * gate that never ran has no opinion about the product.
 *
 * Run 2026083057881445 is what the other behaviour costs. One defect (a tsconfig path alias
 * that emits an unresolvable specifier, #1757) produced five separate red gates, each
 * printing the same Functions worker stack trace, because every gate independently started
 * the app and independently reported the same corpse. Five reds read as five findings; a
 * reader triaging that has to work out by hand that four of them are echoes.
 *
 * This does not make anything greener. `NOT_ATTEMPTED_EXIT_CODE` is `EXIT_GRADER_ERROR`, so
 * the assertion still fails and `runtime-app-starts` still reports the defect — the run stays
 * exactly as red as it was. What changes is the diagnosis, which is the entire point of the
 * verdict.
 *
 * Deliberately narrow. `notApplicable` is untouched, because stacks declare known gaps
 * against those reason codes by name for all five gates at once (see the
 * `functionsHostUnavailable` entry in react-functions-postgres.yaml), and rewriting four of
 * them into a precondition would silently invalidate that declaration. `harnessFault` is
 * untouched too: that one says *our* code broke, and it should be loud in every gate it
 * breaks rather than attributed away to a gate that may have run fine.
 */
function describeUnusableSession(
    session: RuntimeSession,
    options: { ownsStartup?: boolean } = {},
): RuntimeValidationResult | undefined {
    switch (session.kind) {
        case 'started':
            return undefined;
        case 'notApplicable':
            return notApplicable(session.reason, session.detail);
        case 'notAttempted':
            return notAttempted(session.precondition, session.detail);
        case 'harnessFault':
            return harnessFault(session.message, session.output);
        case 'productFailure':
            if (!options.ownsStartup) {
                return notAttempted(
                    'the application starts',
                    'the app under test never started, so this gate never got the running app it grades. '
                    + 'runtime-app-starts owns that failure and reports it with the startup output; nothing '
                    + 'here is a separate finding.',
                );
            }
            return failure(session.code, '$.runtime', session.message, session.output);
    }
}

async function hasServedMarkup(workspaceRoot: string): Promise<boolean> {
    for (const root of STATIC_ROOTS) {
        try {
            await fs.access(path.join(workspaceRoot, root, 'index.html'));
            return true;
        } catch {
            // Try the next root.
        }
    }
    return false;
}

async function findContainerDatastore(packageDirectory: string): Promise<string | undefined> {
    try {
        const manifest = JSON.parse(await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
        };
        return CONTAINER_DATASTORE_PACKAGES.find(name => manifest.dependencies?.[name]);
    } catch {
        return undefined;
    }
}

/** Same-origin paths the served frontend calls, gathered from the document and its scripts. */
/**
 * Same-origin paths the served frontend calls, plus whether it makes HTTP calls *at all*.
 *
 * The second half is what stops this gate lying. A frontend that writes
 * `` fetch(`${base}/items`) `` — an env-configured API base, which is the ordinary way a
 * generated app is written, not an exotic one — defeats the path extraction below while
 * plainly making calls. Without `usesHttpClient` the gate could not tell that from a
 * frontend that calls nothing, and reported the second, which is the failure it exists to
 * catch. Distinguishing them is the difference between "the product is broken" and "our
 * parser cannot read this".
 */
async function collectApiCalls(baseUrl: string, document: string): Promise<{ calls: string[]; usesHttpClient: boolean }> {
    const sources = [document, ...await fetchScripts(baseUrl, document)];
    const calls = new Set<string>();
    let usesHttpClient = false;
    for (const source of sources) {
        for (const call of findApiCalls(source)) {
            calls.add(call);
        }
        if (HTTP_CLIENT_TOKENS.test(source)) {
            usesHttpClient = true;
        }
    }
    return { calls: [...calls].sort(), usesHttpClient };
}

/** Evidence that the frontend issues HTTP requests, independent of whether we can read the URL. */
const HTTP_CLIENT_TOKENS = /\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b|\$\.ajax\s*\(|\buseSWR\s*\(|\buseQuery\s*\(/;

async function fetchScripts(baseUrl: string, document: string): Promise<string[]> {
    const bodies: string[] = [];
    for (const match of document.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
        const source = match[1];
        if (/^https?:/i.test(source)) {
            continue;
        }
        const result = await probe(`${baseUrl}/${source.replace(/^\//, '')}`);
        if (result.ok && isSuccess(result.response.status)) {
            bodies.push(result.response.body);
        }
    }
    return bodies;
}

/**
 * Same-origin request paths in JavaScript. Absolute paths only — a relative or templated
 * URL cannot be resolved without executing the page, and guessing at one would invent
 * findings rather than report them.
 */
function findApiCalls(source: string): string[] {
    const calls = new Set<string>();
    const patterns = [
        /\bfetch\s*\(\s*['"`](\/[^'"`\s?#]*)/g,
        /\baxios\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`](\/[^'"`\s?#]*)/g,
        /\baxios\s*\(\s*\{[^}]*url\s*:\s*['"`](\/[^'"`\s?#]*)/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            // Static assets are served by the same app but are not API wiring.
            if (!/\.(?:js|css|html|png|jpe?g|svg|ico|woff2?)$/i.test(match[1])) {
                calls.add(match[1]);
            }
        }
    }
    return [...calls];
}

interface CollectionEndpoint {
    path: string;
    /** Field names the frontend sends, so the probe posts a body the API will accept. */
    fields: string[];
}

/**
 * Find a collection endpoint by reading what the frontend actually posts.
 *
 * The field names matter as much as the path: a probe that posts `{}` gets a 400 from a
 * correctly-implemented API, which would be a fabricated failure. Taking the shape from the
 * frontend's own `JSON.stringify` means the probe sends what the app expects.
 */
async function findCollectionEndpoint(baseUrl: string, document: string): Promise<CollectionEndpoint | undefined> {
    for (const source of [document, ...await fetchScripts(baseUrl, document)]) {
        for (const match of source.matchAll(/\bfetch\s*\(\s*['"`](\/[^'"`\s?#]*)['"`]\s*,/g)) {
            // Scan from the `fetch(` paren itself: starting after the first comma would find
            // the *inner* call's brackets and read the wrong body shape.
            const call = readBalanced(source, source.indexOf('(', match.index), '(', ')');
            if (!call || !/method\s*:\s*['"`]POST['"`]/i.test(call)) {
                continue;
            }
            const stringify = call.indexOf('JSON.stringify(');
            if (stringify < 0) {
                continue;
            }
            const body = readBalanced(call, stringify + 'JSON.stringify'.length, '(', ')');
            const fields = body ? readTopLevelKeys(body) : [];
            if (fields.length > 0) {
                return { path: match[1], fields };
            }
        }
    }
    return undefined;
}

/**
 * Read the balanced `open`…`close` region starting at `from`, skipping quoted text.
 *
 * A regex cannot do this: the argument list of a `fetch` call contains nested objects and
 * strings that may hold brackets, and matching the wrong closing bracket would silently
 * read the wrong body shape.
 *
 * Regex *literals* are skipped too. A pattern like `/['"]/` would otherwise open a quote
 * that never closes, desynchronising the bracket depth for the rest of the scan — which
 * doesn't crash, it just makes gate 5 quietly report "no collection route" and stop testing
 * anything, the exact silent degradation this file is written to avoid.
 */
function readBalanced(source: string, from: number, open: string, close: string): string | undefined {
    const start = source.indexOf(open, from);
    if (start < 0) {
        return undefined;
    }
    let depth = 0;
    let quote: string | undefined;
    let previous = '';
    for (let index = start; index < source.length; index++) {
        const character = source[index];
        if (quote) {
            if (character === '\\') {
                index++;
            } else if (character === quote) {
                quote = undefined;
            }
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
        } else if (character === '/' && startsRegexLiteral(previous)) {
            const end = findRegexLiteralEnd(source, index);
            if (end === undefined) {
                return undefined;
            }
            index = end;
        } else if (character === open) {
            depth++;
        } else if (character === close) {
            depth--;
            if (depth === 0) {
                return source.slice(start + 1, index);
            }
        }
        if (character.trim()) {
            previous = character;
        }
    }
    return undefined;
}

/**
 * Whether a `/` at this point starts a regex literal rather than a division.
 *
 * The distinction is genuinely ambiguous in JavaScript, so this uses the standard
 * approximation: after a value, `/` divides; after an operator or an opening bracket, it
 * begins a pattern. Inside a `fetch` argument list the second case is the only one that
 * occurs in practice.
 */
function startsRegexLiteral(previous: string): boolean {
    return previous === '' || '(,=:[!&|?{};+-*%<>~^'.includes(previous);
}

function findRegexLiteralEnd(source: string, start: number): number | undefined {
    let inClass = false;
    for (let index = start + 1; index < source.length; index++) {
        const character = source[index];
        if (character === '\\') {
            index++;
        } else if (character === '[') {
            inClass = true;
        } else if (character === ']') {
            inClass = false;
        } else if (character === '/' && !inClass) {
            return index;
        } else if (character === '\n') {
            return undefined;
        }
    }
    return undefined;
}

/** Property names at the top level of an object literal, ignoring nested objects. */
function readTopLevelKeys(objectLiteral: string): string[] {
    const inner = readBalanced(objectLiteral, 0, '{', '}');
    if (inner === undefined) {
        return [];
    }
    const keys: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let pending = '';
    // After a key is taken, everything up to the next comma is its *value*. Without this
    // the top-level `:` in a ternary read as a second key, and the CRUD probe then posted a
    // field the API never declared — which a correctly-implemented API rejects with 400,
    // manufacturing exactly the fabricated product failure this extraction exists to avoid.
    let inValue = false;
    for (let index = 0; index < inner.length; index++) {
        const character = inner[index];
        if (quote) {
            if (character === '\\') {
                index++;
            } else if (character === quote) {
                quote = undefined;
            }
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
        } else if ('{(['.includes(character)) {
            depth++;
        } else if ('})]'.includes(character)) {
            depth--;
        } else if (character === ':' && depth === 0 && !inValue) {
            const key = /([A-Za-z_$][\w$]*)\s*$/.exec(pending.replace(/['"]/g, ''));
            if (key) {
                keys.push(key[1]);
            }
            inValue = true;
            pending = '';
            continue;
        } else if (character === ',' && depth === 0) {
            inValue = false;
            pending = '';
            continue;
        }
        pending += character;
    }
    return keys;
}

function looksLikeHtml(response: HttpProbeResponse): boolean {
    return /text\/html/i.test(response.contentType) || /<html[\s>]|<!doctype html/i.test(response.body);
}

function isSuccess(status: number): boolean {
    return status >= 200 && status < 300;
}

function excerpt(body: string): string {
    const trimmed = body.trim().replace(/\s+/g, ' ');
    return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed || '(empty body)';
}

function describeHealthSource(source: string | undefined): string {
    return source === 'apiTestCollection' ? 'the generated API test collection'
        : source === 'integrationPlan' ? '.azure/integration-plan.md'
            : source === 'debugPlan' ? 'the debug plan'
                : source === 'stackDeclaration' ? 'the stack declaration'
                    : 'the project';
}

function issue(code: string, target: string, message: string): ArtifactValidationIssue {
    return { code, path: target, message };
}

function pass(diagnostics: string[]): RuntimeValidationResult {
    return { valid: true, issues: [], diagnostics };
}

/**
 * A product failure, with the app's own output attached.
 *
 * "The app failed to start" with nothing else is nearly useless to whoever has to diagnose
 * it, and the stack trace is sitting right there in the child's stderr.
 */
function failure(code: string, target: string, message: string, output: string): RuntimeValidationResult {
    return withOutput({ valid: false, issues: [issue(code, target, message)], diagnostics: [] }, output);
}

function withOutput(result: RuntimeValidationResult, output: string): RuntimeValidationResult {
    const trimmed = output.trim();
    return trimmed
        ? { ...result, diagnostics: [...result.diagnostics, `--- application output ---\n${trimmed}`] }
        : result;
}

/**
 * The gate could not run. Recorded as an issue *and* a flag: the flag drives exit 3 so the
 * agent is never blamed, and the issue makes the golden certification case go red — because
 * a probe that cannot connect for its own reasons must not look like a pass.
 */
function harnessFault(message: string, output: string, code = 'runtimeHarnessFault'): RuntimeValidationResult {
    return withOutput({
        valid: false,
        issues: [issue(code, '$.runtime', message)],
        harnessFault: message,
        diagnostics: [],
    }, output);
}

/**
 * This gate has no opinion about this stack.
 *
 * Also recorded as an issue, for the same reason: the reference fixture is a stack every
 * gate here *can* answer for, so an N/A against it means discovery broke, and certification
 * must show that rather than certify a gate that declined to look.
 */
/**
 * This gate never ran, because something it consumes was not produced.
 *
 * Recorded as an issue as well as a flag, for the same reason the other two non-verdicts
 * are: the reference fixture is a workspace where every precondition holds, so a
 * not-attempted verdict against it means discovery broke, and certification must go red
 * rather than certify a gate that never got as far as looking.
 */
function notAttempted(precondition: string, detail: string): RuntimeValidationResult {
    return {
        valid: false,
        issues: [issue('runtimeNotAttempted', '$.runtime', `${precondition}: ${detail}`)],
        notAttempted: { precondition, detail },
        diagnostics: [],
    };
}

function notApplicable(reason: NotApplicableReason, detail: string): RuntimeValidationResult {
    return {
        valid: false,
        issues: [issue('runtimeNotApplicable', '$.runtime', `${reason}: ${detail}`)],
        notApplicable: { reason, detail },
        diagnostics: [],
    };
}
