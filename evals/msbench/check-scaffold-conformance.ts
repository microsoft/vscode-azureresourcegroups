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
    includeReadiness?: boolean;
    readinessSource?: string;
    childServerExpression?: string;
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
param readinessPrincipalId string

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

resource readinessReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(pg.id, readinessPrincipalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  scope: pg
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: readinessPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output serverName string = pg.name
`;

const readinessModule = `param location string
param serverName string
param subscriptionId string
param managedIdentityResourceId string

resource readiness 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'wait-postgres'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '\${managedIdentityResourceId}': {}
    }
  }
  properties: {
    azCliVersion: '2.89.0'
    timeout: 'PT20M'
    environmentVariables: [
      { name: 'SUBSCRIPTION_ID', value: subscriptionId }
      { name: 'RESOURCE_GROUP', value: resourceGroup().name }
      { name: 'SERVER_NAME', value: serverName }
    ]
    scriptContent: '''
      for attempt in $(seq 1 40); do
        state=$(az postgres flexible-server show --subscription "$SUBSCRIPTION_ID" --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" --query state -o tsv || true)
        if [ "$state" = "Ready" ]; then
          if az postgres flexible-server microsoft-entra-admin list --subscription "$SUBSCRIPTION_ID" --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --output none 2>/dev/null; then
            sleep 90
            printf '{"ready":true}\\n' > "$AZ_SCRIPTS_OUTPUT_PATH"
            exit 0
          fi
        fi
        sleep 15
      done
      printf '{"ready":false}\\n' > "$AZ_SCRIPTS_OUTPUT_PATH"
      exit 1
    '''
  }
}

output serverName string = serverName
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

function mainModule(includeReadiness = true, childServerExpression = "pgReadiness.outputs.serverName"): string {
    const readiness = includeReadiness
        ? `
module pgReadiness 'modules/postgres-readiness.bicep' = {
  name: 'postgres-readiness'
  scope: rg
  params: {
    location: 'westus2'
    serverName: pg.outputs.serverName
    subscriptionId: subscription().subscriptionId
    managedIdentityResourceId: '/subscriptions/test/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/readiness'
  }
}
`
        : "";
    return `targetScope = 'subscription'

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
    readinessPrincipalId: entraAdminObjectId
  }
}

${readiness}
module pgChildren 'modules/postgres-children.bicep' = {
  name: 'postgres-children'
  scope: rg
  params: {
    pgName: ${childServerExpression}
    entraAdminObjectId: entraAdminObjectId
  }
}
`;
}

const fixtures: Fixture[] = [
    { name: "canonical", adminName: "entraAdminObjectId", colocateAdmin: false },
    { name: "display-label", adminName: "'activeDirectory'", colocateAdmin: false, expectedFailure: "PG-ENTRA-ADMIN-ID" },
    { name: "literal-guid", adminName: "'11111111-2222-3333-4444-555555555555'", colocateAdmin: false, expectedFailure: "PG-ENTRA-ADMIN-ID" },
    { name: "same-deployment", adminName: "entraAdminObjectId", colocateAdmin: true, expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "wrong-existing-target", adminName: "entraAdminObjectId", colocateAdmin: false, existingName: "'pg-test'", expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "missing-readiness", adminName: "entraAdminObjectId", colocateAdmin: false, includeReadiness: false, childServerExpression: "pg.outputs.serverName", expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "bypassed-readiness", adminName: "entraAdminObjectId", colocateAdmin: false, childServerExpression: "pg.outputs.serverName", expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "missing-readiness-environment", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace(/ {4}environmentVariables: \[[\s\S]*? {4}\]\n/, ""), expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "unscoped-readiness-show", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace('--subscription "$SUBSCRIPTION_ID" --resource-group "$RESOURCE_GROUP" ', ""), expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "missing-provider-probe", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace(/ {10}if az postgres flexible-server microsoft-entra-admin list[^\n]+/, "          if false; then"), expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "unscoped-provider-probe", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace('microsoft-entra-admin list --subscription "$SUBSCRIPTION_ID" --resource-group "$RESOURCE_GROUP" --server-name', 'microsoft-entra-admin list --server-name'), expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "short-stabilization", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace("sleep 90", "sleep 30"), expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "jq-readiness", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace("--query state -o tsv", "-o json | jq -r .state"), expectedFailure: "PG-ADMIN-READY-BARRIER" },
    { name: "success-on-timeout", adminName: "entraAdminObjectId", colocateAdmin: false, readinessSource: readinessModule.replace('      exit 1\n', '      exit 0\n'), expectedFailure: "PG-ADMIN-READY-BARRIER" },
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
            writeFileSync(
                join(infraDir, "main.bicep"),
                mainModule(fixture.includeReadiness !== false, fixture.childServerExpression),
            );
            writeFileSync(join(modulesDir, "postgres.bicep"), serverModule);
            writeFileSync(join(modulesDir, "postgres-children.bicep"), adminModule(fixture.adminName, false, fixture.existingName));
            if (fixture.includeReadiness !== false) {
                writeFileSync(join(modulesDir, "postgres-readiness.bicep"), fixture.readinessSource ?? readinessModule);
            }
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

console.log(`✔ Scaffold conformance scripts reject ${fixtures.length - 1} PostgreSQL administrator/readiness mutations.`);
