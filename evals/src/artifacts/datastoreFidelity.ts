/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Does the scaffold wire the datastore the plan chose?
 *
 * This is the fidelity failure with the worst signal-to-consequence ratio: a project that
 * plans PostgreSQL and quietly wires SQLite installs, builds, starts, serves traffic and
 * passes every other gate we have. It only fails later, in a place where the plan is no
 * longer in the room. Nothing else in the suite can see it.
 *
 * ## How the comparison is made
 *
 * Both sides are normalised to a closed set of **families** and compared as families, never
 * as strings. The plan's wording and the package registry's wording never match — "Azure
 * Database for PostgreSQL Flexible Server" versus `pg` — so any string comparison is really
 * a table lookup wearing a disguise, and one that silently returns "no match" for every
 * spelling nobody thought of.
 *
 * ## Evidence
 *
 * A family is *wired* when the source **imports** a driver for it — not when a manifest
 * declares one. A dependency that is installed and never imported is not a datastore, it is
 * a leftover, and treating declaration as wiring is what would let "swap the import" pass.
 *
 * Manifest declarations are still read, for the opposite direction: code that imports a
 * driver no manifest declares cannot install, which is its own defect.
 *
 * The one case where an import cannot be required is an ORM: a project using Prisma or
 * SQLAlchemy legitimately never imports `pg`. There, a connection string or provider
 * setting naming the family counts instead — but *only* when such an ORM is present, so
 * this never degrades into "the tree mentions postgres somewhere".
 *
 * ## Ecosystems
 *
 * Node, Python and .NET have driver registries below. Anything else reports
 * not-applicable rather than passing: a datastore check that silently approves every Go
 * project is indistinguishable from no check at all, which is the failure this suite exists
 * to prevent.
 */

import type { PlannedResource } from './plannedProject.ts';
import { readPlannedProject } from './plannedProject.ts';
import type { Ecosystem, ScaffoldTree } from './scaffoldTree.ts';
import { scanScaffoldTree } from './scaffoldTree.ts';
import type { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes.ts';
import { createValidationResult } from './validationTypes.ts';

export type DatastoreFamily =
    | 'postgres' | 'mysql' | 'mssql' | 'sqlite' | 'mongodb' | 'cosmos' | 'redis'
    | 'blob-storage' | 'table-storage' | 'queue-storage' | 'file' | 'in-memory';

/**
 * Issue codes that mean "this gate has no opinion here", not "the agent did something
 * wrong", mapped to the class each implies. The grader turns these into a not-applicable
 * verdict; they must never be reported as a product failure.
 *
 * `coverageGap` rather than `outOfScope`: a Go project is not a scenario with nothing to
 * test, it is one we are failing to test. The remedy is "write the analyser", not "unwire
 * the gate", and the class is what tells those apart.
 */
export const DATASTORE_NOT_APPLICABLE_CODES: Record<string, 'outOfScope' | 'coverageGap'> = {
    ecosystemNotSupported: 'coverageGap',
};

interface FamilySignature {
    /** Package names as they appear in a manifest. */
    packages: Partial<Record<Ecosystem, string[]>>;
    /** Module names as they appear in an import. Defaults to `packages` when omitted. */
    modules?: Partial<Record<Ecosystem, string[]>>;
    /** Modules that ship with the runtime and so can never appear in a manifest. */
    stdlibModules?: Partial<Record<Ecosystem, string[]>>;
    /** Connection-string schemes and ORM provider values that name this family. */
    connectionPatterns: RegExp[];
    /** Plan wordings, longest matched first so "cosmos db for mongodb" beats "cosmos db". */
    planAliases: string[];
}

const FAMILIES: Record<DatastoreFamily, FamilySignature> = {
    postgres: {
        packages: {
            node: ['pg', 'postgres', 'pg-promise', '@vercel/postgres'],
            python: ['psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg', 'pg8000'],
            dotnet: ['npgsql', 'npgsql.entityframeworkcore.postgresql'],
        },
        modules: { python: ['psycopg', 'psycopg2', 'asyncpg', 'pg8000'], dotnet: ['npgsql'] },
        connectionPatterns: [/postgres(ql)?:\/\//i, /provider\s*=\s*["']postgresql["']/i, /usenpgsql/i],
        planAliases: ['azure database for postgresql', 'postgresql flexible server', 'postgresql', 'postgres'],
    },
    mysql: {
        packages: {
            node: ['mysql', 'mysql2'],
            python: ['pymysql', 'mysqlclient', 'aiomysql', 'mysql-connector-python'],
            dotnet: ['mysqlconnector', 'pomelo.entityframeworkcore.mysql'],
        },
        modules: { python: ['pymysql', 'mysqldb', 'aiomysql', 'mysql'], dotnet: ['mysqlconnector'] },
        connectionPatterns: [/mysql:\/\//i, /mariadb:\/\//i, /provider\s*=\s*["']mysql["']/i],
        planAliases: ['azure database for mysql', 'mariadb', 'mysql'],
    },
    mssql: {
        packages: {
            node: ['mssql', 'tedious'],
            python: ['pyodbc', 'pymssql'],
            dotnet: ['microsoft.data.sqlclient', 'system.data.sqlclient', 'microsoft.entityframeworkcore.sqlserver'],
        },
        modules: { dotnet: ['microsoft.data.sqlclient', 'system.data.sqlclient'] },
        connectionPatterns: [/sqlserver:\/\//i, /\bserver\s*=\s*tcp:/i, /initial\s+catalog\s*=/i, /usesqlserver/i],
        planAliases: ['azure sql database', 'azure sql', 'sql server', 'sql database', 'mssql'],
    },
    sqlite: {
        packages: {
            node: ['sqlite3', 'better-sqlite3', 'sqlite'],
            python: ['aiosqlite'],
            dotnet: ['microsoft.data.sqlite', 'microsoft.entityframeworkcore.sqlite'],
        },
        modules: { node: ['sqlite3', 'better-sqlite3', 'sqlite'], dotnet: ['microsoft.data.sqlite'] },
        // `sqlite3` is in the Python standard library and `node:sqlite` in Node's, so neither
        // can ever appear in a manifest. Requiring a declaration for them would make the most
        // common quiet-swap target the one family we structurally cannot catch.
        stdlibModules: { python: ['sqlite3'], node: ['node:sqlite'] },
        connectionPatterns: [/sqlite:\/\//i, /provider\s*=\s*["']sqlite["']/i, /\.sqlite3?\b/i],
        planAliases: ['sqlite'],
    },
    mongodb: {
        packages: {
            node: ['mongodb', 'mongoose'],
            python: ['pymongo', 'motor', 'beanie'],
            dotnet: ['mongodb.driver'],
        },
        connectionPatterns: [/mongodb(\+srv)?:\/\//i],
        planAliases: ['azure cosmos db for mongodb', 'cosmos db for mongodb', 'mongodb', 'mongo'],
    },
    cosmos: {
        packages: {
            node: ['@azure/cosmos'],
            python: ['azure-cosmos'],
            dotnet: ['microsoft.azure.cosmos'],
        },
        connectionPatterns: [/accountendpoint\s*=/i, /documents\.azure\.com/i],
        planAliases: ['azure cosmos db for nosql', 'azure cosmos db', 'cosmos db', 'cosmos'],
    },
    redis: {
        packages: {
            node: ['redis', 'ioredis'],
            python: ['redis', 'aioredis'],
            dotnet: ['stackexchange.redis'],
        },
        connectionPatterns: [/rediss?:\/\//i],
        planAliases: ['azure cache for redis', 'redis'],
    },
    'blob-storage': {
        packages: {
            node: ['@azure/storage-blob'],
            python: ['azure-storage-blob'],
            dotnet: ['azure.storage.blobs'],
        },
        connectionPatterns: [/blob\.core\.windows\.net/i],
        planAliases: ['azure blob storage', 'blob storage', 'blob'],
    },
    'table-storage': {
        packages: {
            node: ['@azure/data-tables'],
            python: ['azure-data-tables'],
            dotnet: ['azure.data.tables'],
        },
        connectionPatterns: [/table\.core\.windows\.net/i],
        planAliases: ['azure table storage', 'table storage'],
    },
    'queue-storage': {
        packages: {
            node: ['@azure/storage-queue'],
            python: ['azure-storage-queue'],
            dotnet: ['azure.storage.queues'],
        },
        connectionPatterns: [/queue\.core\.windows\.net/i],
        planAliases: ['azure queue storage', 'queue storage', 'storage queue'],
    },
    // Families with no driver to import. They are resolvable so the plan side can name them,
    // but wiring is never asserted for them — a JSON file on disk has no import signature.
    file: { packages: {}, connectionPatterns: [], planAliases: ['file storage', 'file store', 'local file', 'json file'] },
    'in-memory': { packages: {}, connectionPatterns: [], planAliases: ['in-memory', 'in memory', 'no datastore required'] },
};

/** Families whose wiring cannot be observed in the tree, so absence proves nothing. */
const UNOBSERVABLE_FAMILIES = new Set<DatastoreFamily>(['file', 'in-memory']);

/**
 * ORMs and query builders that own the driver import on the application's behalf. Their
 * presence is what licenses connection-string evidence to stand in for an import.
 */
const ORM_PACKAGES: Record<Ecosystem, string[]> = {
    node: ['prisma', '@prisma/client', 'sequelize', 'typeorm', 'knex', 'drizzle-orm', 'objection', 'mikro-orm'],
    python: ['sqlalchemy', 'django', 'tortoise-orm', 'peewee', 'alembic', 'sqlmodel'],
    dotnet: ['microsoft.entityframeworkcore', 'entityframework', 'dapper'],
};

export async function validateDatastoreFidelity(
    workspaceRoot: string,
    planMarkdown: string,
): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];
    const plan = readPlannedProject(planMarkdown);
    const tree = await scanScaffoldTree(workspaceRoot);

    if (tree.unsupported.length > 0) {
        // One unsupported manifest blinds the whole comparison: that service's dependencies
        // and imports are both invisible, so any "not wired" verdict here would be the
        // harness's gap reported as the agent's fault. See serviceFidelity for the same rule.
        const languages = [...new Set(tree.unsupported.map(entry => entry.language))].join(', ');
        return createValidationResult([issue('ecosystemNotSupported', tree.unsupported[0].file,
            `This gate has no dependency analyser for ${languages} yet, so it cannot tell whether the planned datastore was wired. The fix is unwritten code in evals/src/artifacts/datastoreFidelity.ts, not a missing tool on this machine.`)]);
    }

    if (!plan.resourcesTableRecognised) {
        return createValidationResult([issue(
            'plannedResourcesUnreadable',
            '$.servicesRequired',
            'The plan has no readable "Services Required" table (expected an "Azure Service" column), so what it promised cannot be compared with what was built.',
        )]);
    }

    if (tree.manifests.length === 0) {
        // The plan was read from this same workspace, so the tree is staged and genuinely
        // contains no project. That is a product failure, not a harness one.
        return createValidationResult([issue('noServicesScaffolded', '.',
            'The workspace contains no project manifest of any recognised ecosystem, so nothing can be wired to the resources the plan promised.')]);
    }

    const planned = plan.resources.map(resource => ({ resource, family: resolveFamily(resource) }));
    const plannedFamilies = new Set(planned.flatMap(entry => entry.family ? [entry.family] : []));
    const wired = collectWiring(tree);

    for (const { resource, family } of planned) {
        checkPlannedResource(resource, family, tree, wired, issues);
    }
    checkUnplannedFamilies(plannedFamilies, wired, issues);

    return createValidationResult(issues);
}

interface Wiring {
    /** Families with an import of one of their drivers, by scope, recording the modules seen. */
    imported: Map<DatastoreFamily, { runtime: string[]; test: string[]; modules: Set<string> }>;
    /** Families declared in some manifest. */
    declared: Map<DatastoreFamily, string[]>;
    /** Families named by a connection string or ORM provider setting in the tree. */
    configured: Map<DatastoreFamily, string[]>;
    hasOrm: boolean;
}

function collectWiring(tree: ScaffoldTree): Wiring {
    const wiring: Wiring = { imported: new Map(), declared: new Map(), configured: new Map(), hasOrm: false };

    for (const dependency of tree.dependencies) {
        if (isOrm(dependency.name, dependency.ecosystem)) {
            wiring.hasOrm = true;
        }
        const family = familyForPackage(dependency.name, dependency.ecosystem);
        if (family) {
            push(wiring.declared, family, dependency.manifest);
        }
    }

    for (const imported of tree.imports) {
        if (isOrm(imported.module, imported.ecosystem)) {
            wiring.hasOrm = true;
        }
        const family = familyForModule(imported.module, imported.ecosystem);
        if (!family) {
            continue;
        }
        const entry = wiring.imported.get(family) ?? { runtime: [], test: [], modules: new Set<string>() };
        entry[imported.scope].push(imported.file);
        entry.modules.add(imported.module);
        wiring.imported.set(family, entry);
    }

    for (const [file, content] of tree.fileContents) {
        for (const [name, signature] of Object.entries(FAMILIES) as Array<[DatastoreFamily, FamilySignature]>) {
            if (signature.connectionPatterns.some(pattern => pattern.test(content))) {
                push(wiring.configured, name, file);
            }
        }
    }

    return wiring;
}

/**
 * Recognise an ORM from a package name or an import.
 *
 * Provider packages matter as much as the core one: the canonical PostgreSQL binding for EF
 * Core is `Npgsql.EntityFrameworkCore.PostgreSQL` and the MySQL one is
 * `Pomelo.EntityFrameworkCore.MySql`, neither of which starts with `microsoft.`. Matching
 * only the Microsoft prefix left a textbook EF Core project looking like it had no ORM, so
 * its connection-string evidence was refused and the gate failed a correct app.
 */
function isOrm(name: string, ecosystem: Ecosystem): boolean {
    if (ecosystem === 'dotnet' && /entityframeworkcore/.test(name)) {
        return true;
    }
    return ORM_PACKAGES[ecosystem].some(orm => name === orm || name.startsWith(`${orm}.`) || name.startsWith(`${orm}/`));
}

function checkPlannedResource(
    resource: PlannedResource,
    family: DatastoreFamily | undefined,
    tree: ScaffoldTree,
    wired: Wiring,
    issues: ArtifactValidationIssue[],
): void {
    checkEnvironmentVariable(resource, tree, issues);

    if (!family || UNOBSERVABLE_FAMILIES.has(family)) {
        return;
    }
    if (!hasAnalyserFor(family, tree.ecosystems)) {
        // Silence here would be a pass, so say nothing about wiring rather than approve it.
        return;
    }

    const imported = wired.imported.get(family);
    const configured = wired.configured.get(family);
    const declared = wired.declared.get(family);

    // Runtime scope only. A driver imported solely from a test file is not the application's
    // datastore — an app whose runtime code never touches PostgreSQL has not wired it, however
    // thoroughly its test suite does. The unplanned direction applies the same rule, so the two
    // halves of this gate cannot disagree about what "wired" means.
    if (imported && imported.runtime.length > 0) {
        if (!declared && !isStdlibImport(family, imported.modules)) {
            issues.push(issue(
                'datastoreDependencyMissing',
                imported.runtime[0],
                `${resource.azureService} is imported but no manifest declares a ${family} driver, so the project cannot install.`,
            ));
        }
        return;
    }

    // An ORM owns the driver import, so a connection string naming the family is the only
    // evidence available and is accepted — but only with an ORM present.
    if (wired.hasOrm && configured) {
        return;
    }

    const testOnly = imported && imported.test.length > 0;
    issues.push(issue(
        'plannedDatastoreNotWired',
        '$.servicesRequired',
        `The plan chose ${resource.azureService} (${family}) but no runtime source file imports a ${family} driver${testOnly
            ? ` — the only import is from ${imported.test[0]}, which is test scope`
            : declared ? ` — ${declared[0]} declares one that is never imported, which is not wiring` : ''}.`,
    ));
}

/**
 * A family the plan never named, wired at runtime, is an invented datastore.
 *
 * Only runtime-scope imports count. A test suite that spins up in-memory SQLite on a
 * PostgreSQL project is ordinary practice, and reporting it would train people to ignore
 * this gate — which costs more than the case it would catch.
 */
function checkUnplannedFamilies(
    plannedFamilies: Set<DatastoreFamily>,
    wired: Wiring,
    issues: ArtifactValidationIssue[],
): void {
    for (const [family, files] of wired.imported) {
        if (plannedFamilies.has(family) || files.runtime.length === 0) {
            continue;
        }
        issues.push(issue(
            'unplannedDatastoreWired',
            files.runtime[0],
            `${family} is wired at runtime but the plan's Services Required table never mentions it.`,
        ));
    }
}

/**
 * The plan's `Environment Variable` column is a contract between the app and the infra that
 * provisions it, and it is entirely stack-neutral to check: the name is a literal string
 * that must appear somewhere outside the plan. This catches a promised resource that was
 * never wired at all, including resources with no driver signature (Service Bus, Key Vault).
 */
function checkEnvironmentVariable(
    resource: PlannedResource,
    tree: ScaffoldTree,
    issues: ArtifactValidationIssue[],
): void {
    const variable = resource.environmentVariable;
    if (!variable || !/^[A-Z][A-Z0-9_]*$/.test(variable)) {
        return;
    }
    if (!tree.files.some(file => tree.fileContents.get(file)?.includes(variable))) {
        issues.push(issue(
            'plannedResourceNotWired',
            '$.servicesRequired',
            `The plan promised ${resource.azureService} via ${variable}, but that variable appears nowhere in the scaffolded tree.`,
        ));
    }
}

function resolveFamily(resource: PlannedResource): DatastoreFamily | undefined {
    // Scheme first, name second, and the order matters more than it looks. "Azure Cosmos DB
    // for MongoDB" speaks the MongoDB wire protocol, so the code must import a MongoDB
    // driver — a name-first reading resolves it to `cosmos`, finds no `@azure/cosmos`, and
    // reports a confident failure against a correctly built project. The local connection
    // string is the plan's own statement of which protocol it meant.
    const local = resource.localDefault;
    if (local) {
        for (const [family, signature] of Object.entries(FAMILIES) as Array<[DatastoreFamily, FamilySignature]>) {
            if (signature.connectionPatterns.some(pattern => pattern.test(local))) {
                return family;
            }
        }
    }

    const name = resource.azureService.toLowerCase();
    const aliases = (Object.entries(FAMILIES) as Array<[DatastoreFamily, FamilySignature]>)
        .flatMap(([family, signature]) => signature.planAliases.map(alias => ({ family, alias })))
        .sort((left, right) => right.alias.length - left.alias.length);
    return aliases.find(entry => name.includes(entry.alias))?.family;
}

function familyForPackage(name: string, ecosystem: Ecosystem): DatastoreFamily | undefined {
    for (const [family, signature] of Object.entries(FAMILIES) as Array<[DatastoreFamily, FamilySignature]>) {
        if ((signature.packages[ecosystem] ?? []).includes(name)) {
            return family;
        }
    }
    return undefined;
}

function familyForModule(module: string, ecosystem: Ecosystem): DatastoreFamily | undefined {
    for (const [family, signature] of Object.entries(FAMILIES) as Array<[DatastoreFamily, FamilySignature]>) {
        const modules = signature.modules?.[ecosystem] ?? signature.packages[ecosystem] ?? [];
        const stdlib = signature.stdlibModules?.[ecosystem] ?? [];
        if (modules.includes(module) || stdlib.includes(module)) {
            return family;
        }
    }
    return undefined;
}

function hasAnalyserFor(family: DatastoreFamily, ecosystems: Set<Ecosystem>): boolean {
    const signature = FAMILIES[family];
    return [...ecosystems].some(ecosystem =>
        (signature.packages[ecosystem]?.length ?? 0) > 0 || (signature.stdlibModules?.[ecosystem]?.length ?? 0) > 0);
}

/**
 * Whether the modules that were actually imported are runtime built-ins, and so could not
 * appear in any manifest.
 *
 * Asking "does this family have a stdlib module in some present ecosystem" instead would
 * disable the undeclared-driver check for the entire SQLite family in any Node or Python
 * tree — including `better-sqlite3`, which absolutely must be declared. The question has to
 * be about the specific import that fired.
 */
function isStdlibImport(family: DatastoreFamily, modules: Set<string>): boolean {
    const stdlib = FAMILIES[family].stdlibModules;
    if (!stdlib) {
        return false;
    }
    const all = new Set(Object.values(stdlib).flat());
    return [...modules].every(module => all.has(module));
}

function push<T>(map: Map<T, string[]>, key: T, value: string): void {
    map.set(key, [...(map.get(key) ?? []), value]);
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}
