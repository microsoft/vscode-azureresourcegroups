#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface ConformanceResult {
    passed: boolean;
    failures: { id: string }[];
}

interface Fixture {
    name: string;
    adminName: string;
    colocateAdmin: boolean;
    existingName?: string;
    expectedFailure?: string;
}

const repoRoot = resolve(import.meta.dirname, "..", "..");
const sourceDir = join(repoRoot, "resources", "agents", "azure-deploy", "scaffold", "scripts");

function resolvePowerShell(): string {
    for (const candidate of ["pwsh", "powershell.exe"]) {
        const probe = spawnSync(candidate, ["-NoLogo", "-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
        if (!probe.error && probe.status === 0) {
            return candidate;
        }
    }
    throw new Error("Neither pwsh nor powershell.exe is available.");
}

const powerShell = resolvePowerShell();
const root = mkdtempSync(join(tmpdir(), "scaffold-conformance-"));

const serverModule = `param pgName string
param location string

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
    }
  }
}

output serverName string = pg.name
`;

function adminModule(adminName: string, includeServer: boolean, existingName = "pgName"): string {
    const server = includeServer
        ? serverModule.replace("\noutput serverName string = pg.name\n", "")
        : `param pgName string

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: ${existingName}
}
`;
    return `${server}
param entraAdminObjectId string

resource pgAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: pg
  name: ${adminName}
  properties: {
    principalType: 'User'
    principalName: 'deployer@example.test'
    tenantId: subscription().tenantId
  }
}
`;
}

const mainModule = `targetScope = 'subscription'

param entraAdminObjectId string

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-test'
  location: 'westus2'
}

module pg 'modules/postgres.bicep' = {
  name: 'postgres'
  scope: rg
  params: {
    pgName: 'pg-test'
    location: 'westus2'
  }
}

module pgChildren 'modules/postgres-children.bicep' = {
  name: 'postgres-children'
  scope: rg
  params: {
    pgName: pg.outputs.serverName
    entraAdminObjectId: entraAdminObjectId
  }
}
`;

const fixtures: Fixture[] = [
    { name: "canonical", adminName: "entraAdminObjectId", colocateAdmin: false },
    { name: "display-label", adminName: "'activeDirectory'", colocateAdmin: false, expectedFailure: "PG-ENTRA-ADMIN-ID" },
    { name: "literal-guid", adminName: "'11111111-2222-3333-4444-555555555555'", colocateAdmin: false, expectedFailure: "PG-ENTRA-ADMIN-ID" },
    { name: "same-deployment", adminName: "entraAdminObjectId", colocateAdmin: true, expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "wrong-existing-target", adminName: "entraAdminObjectId", colocateAdmin: false, existingName: "'pg-test'", expectedFailure: "PG-ADMIN-READY-BARRIER" },
];

function run(command: string, args: string[], cwd: string): ConformanceResult {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    if (result.error) {
        throw new Error(`${command} could not run: ${result.error.message}`);
    }
    const stdout = result.stdout.trim();
    if (!stdout) {
        throw new Error(`${command} produced no JSON.\nstderr:\n${result.stderr}`);
    }
    let parsed: ConformanceResult;
    try {
        parsed = JSON.parse(stdout) as ConformanceResult;
    } catch {
        throw new Error(`${command} produced invalid JSON:\n${stdout}\nstderr:\n${result.stderr}`);
    }
    const expectedStatus = parsed.passed ? 0 : 1;
    if (result.status !== expectedStatus) {
        throw new Error(`${command} returned ${result.status}; JSON requires ${expectedStatus}: ${stdout}`);
    }
    return parsed;
}

function assertFixture(shell: string, result: ConformanceResult, fixture: Fixture): void {
    const ids = result.failures.map(failure => failure.id);
    if (!fixture.expectedFailure) {
        if (!result.passed || ids.length !== 0) {
            throw new Error(`${shell}/${fixture.name}: expected pass, got ${JSON.stringify(result)}`);
        }
        return;
    }
    if (result.passed || !ids.includes(fixture.expectedFailure)) {
        throw new Error(`${shell}/${fixture.name}: expected ${fixture.expectedFailure}, got ${JSON.stringify(result)}`);
    }
}

try {
    const powerShellSource = join(sourceDir, "scaffold-conformance.ps1");
    const powerShellCopy = join(root, "scaffold-conformance.ps1");
    if (powerShell === "powershell.exe") {
        writeFileSync(powerShellCopy, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(powerShellSource)]));
    } else {
        copyFileSync(powerShellSource, powerShellCopy);
    }
    copyFileSync(join(sourceDir, "scaffold-conformance.sh"), join(root, "scaffold-conformance.sh"));

    for (const fixture of fixtures) {
        const caseRoot = join(root, fixture.name);
        const sessionDir = join(caseRoot, "session");
        const infraDir = join(caseRoot, "infra");
        const modulesDir = join(infraDir, "modules");
        mkdirSync(sessionDir, { recursive: true });
        mkdirSync(modulesDir, { recursive: true });
        writeFileSync(
            join(sessionDir, "prepare-plan.json"),
            JSON.stringify({ services: [{ name: "PostgreSQL Flexible Server", version: "16" }] }),
        );

        if (fixture.colocateAdmin) {
            writeFileSync(join(infraDir, "main.bicep"), adminModule(fixture.adminName, true));
        } else {
            writeFileSync(join(infraDir, "main.bicep"), mainModule);
            writeFileSync(join(modulesDir, "postgres.bicep"), serverModule);
            writeFileSync(join(modulesDir, "postgres-children.bicep"), adminModule(fixture.adminName, false, fixture.existingName));
        }

        const psResult = run(
            powerShell,
            ["-NoLogo", "-NoProfile", "-File", join("..", "scaffold-conformance.ps1"), "-SessionPath", "session", "-InfraPath", "infra"],
            caseRoot,
        );
        assertFixture("pwsh", psResult, fixture);

        const bashResult = run(
            "bash",
            ["../scaffold-conformance.sh", "session", "infra"],
            caseRoot,
        );
        assertFixture("bash", bashResult, fixture);
    }
} finally {
    rmSync(root, { recursive: true, force: true });
}

console.log(`✔ Scaffold conformance scripts reject ${fixtures.length - 1} PostgreSQL administrator mutations.`);
