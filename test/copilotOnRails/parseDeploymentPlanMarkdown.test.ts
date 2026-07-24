/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { type DeploymentPlanData } from '../../src/webviews/copilotOnRails/views/utils/deploymentPlanTypes';
import {
    getDeploymentPlanRenderIssue,
    parseDeploymentPlanMarkdown,
} from '../../src/webviews/copilotOnRails/views/utils/parseDeploymentPlanMarkdown';
import { getWorkspaceFolderUri } from '../testUtils';

const attendanceProjectFolder = 'copilotOnRails-attendance';
const scrapbookProjectFolder = 'copilotOnRails-scrapbook';

suite('parseDeploymentPlanMarkdown', () => {
    test('parses the canonical azure-prepare plan without duplicating Service Mapping', () => {
        const plan = parseDeploymentPlanMarkdown(`
# Azure Deployment Plan

> **Status:** Planning

## 1. Requirements

| Attribute | Value |
|-----------|-------|
| **Subscription** | Development |
| **Location** | East US |

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| API | Backend | TypeScript | src/api |

## 5. Architecture

### Service Mapping

| Component | Azure Service | SKU |
|-----------|---------------|-----|
| API | Azure Container Apps | Consumption |

### Supporting Services

| Service | Purpose |
|---------|---------|
| Application Insights | Monitoring |

## 6. Provisioning Limit Checklist

### Resource Inventory & Quota Validation

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---------------|------------------|------------------------|-------------|-------|
| Microsoft.App/containerApps | 1 | 1 | 100 | Within quota |
`);

        assert.strictEqual(plan.status, 'Planning');
        assert.strictEqual(plan.subscription, 'Development');
        assert.strictEqual(plan.location, 'East US');
        assert.deepStrictEqual(plan.workspaceScan.rows, [['API', 'Backend', 'TypeScript', 'src/api']]);
        assert.strictEqual(plan.resourcesHeading, 'Service Mapping');
        assert.deepStrictEqual(plan.resources.rows, [['API', 'Azure Container Apps', 'Consumption']]);
        assert.deepStrictEqual(plan.architecture.map(section => section.title), ['Supporting Services']);
    });

    test('uses common generated headings and plain metadata', () => {
        const plan = parseDeploymentPlanMarkdown(`
# Deployment Plan

**Status: In Progress**

## Application Analysis

| Component | Technology | Path |
|-----------|------------|------|
| Web | React | src/web |

## Azure Services

| Service | SKU | Purpose |
|---------|-----|---------|
| Azure App Service | B1 | Host the application |
`);

        assert.strictEqual(plan.status, 'In Progress');
        assert.deepStrictEqual(plan.workspaceScan.rows, [['Web', 'React', 'src/web']]);
        assert.strictEqual(plan.resourcesHeading, 'Azure Services');
        assert.deepStrictEqual(plan.resources.rows, [['Azure App Service', 'B1', 'Host the application']]);
        assert.strictEqual(getDeploymentPlanRenderIssue('non-empty', plan), undefined);
    });

    test('prioritizes Service Mapping when a quota table appears first', () => {
        const plan = parseDeploymentPlanMarkdown(`
## 3. Provisioning Limit Checklist

### Resource Inventory & Quota Validation

| Resource Type | Number to Deploy | Limit/Quota |
|---------------|------------------|-------------|
| Microsoft.App/containerApps | 1 | 100 |

## 5. Architecture

### **Service Mapping**

| Component | Azure Service | SKU |
|-----------|---------------|-----|
| API | Azure Container Apps | Consumption |
`);

        assert.strictEqual(plan.resourcesHeading, 'Service Mapping');
        assert.deepStrictEqual(plan.resources.rows, [['API', 'Azure Container Apps', 'Consumption']]);
        assert.deepStrictEqual(plan.architecture, []);
    });

    test('classifies a resource table under an unrecognized heading', () => {
        const plan = parseDeploymentPlanMarkdown(`
## Infrastructure Plan

Resource | Tier | Purpose
---------|------|--------
Azure Cosmos DB | Serverless | Store application data
`);

        assert.strictEqual(plan.resourcesHeading, 'Infrastructure Plan');
        assert.deepStrictEqual(plan.resources.rows, [['Azure Cosmos DB', 'Serverless', 'Store application data']]);
    });

    test('classifies workspace and decision tables under unrecognized headings', () => {
        const plan = parseDeploymentPlanMarkdown(`
## Analysis Results

| Component | Technology | Path |
|-----------|------------|------|
| Worker | TypeScript | src/worker |

## Selected Options

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hosting | Functions | Event-driven workload |
`);

        assert.deepStrictEqual(plan.workspaceScan.rows, [['Worker', 'TypeScript', 'src/worker']]);
        assert.deepStrictEqual(plan.decisions.rows, [['Hosting', 'Functions', 'Event-driven workload']]);
    });

    test('reports empty and unsupported plans', () => {
        const emptyPlan = parseDeploymentPlanMarkdown('  \n');
        assert.strictEqual(getDeploymentPlanRenderIssue('  \n', emptyPlan), 'empty');

        const unsupportedMarkdown = '## Deployment Steps\n\n1. Run azd up';
        const unsupportedPlan = parseDeploymentPlanMarkdown(unsupportedMarkdown);
        assert.strictEqual(getDeploymentPlanRenderIssue(unsupportedMarkdown, unsupportedPlan), 'missingStructuredSections');
    });

    test('extracts the requirements table, selected recipe, and stack', () => {
        const plan = parseDeploymentPlanMarkdown(`
## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Development |
| Scale | Small |
| Budget | Cost-Optimized |

## 4. Recipe Selection

**Selected:** AZD (Bicep)

## 5. Architecture

**Stack:** Serverless + Static Web Apps
`);

        assert.ok(plan.requirements, 'Expected a requirements table');
        assert.deepStrictEqual(plan.requirements.rows, [
            ['Classification', 'Development'],
            ['Scale', 'Small'],
            ['Budget', 'Cost-Optimized'],
        ]);
        assert.strictEqual(plan.recipe, 'AZD (Bicep)');
        assert.strictEqual(plan.stack, 'Serverless + Static Web Apps');
    });

    test('leaves recipe and stack undefined when absent', () => {
        const plan = parseDeploymentPlanMarkdown('## Requirements\n\n| Attribute | Value |\n|--|--|\n| Scale | Small |');
        assert.strictEqual(plan.recipe, undefined);
        assert.strictEqual(plan.stack, undefined);
    });

    suite('project fixtures', () => {
        test('attendance plan', () => {
            const plan = loadPlan(attendanceProjectFolder);

            assert.strictEqual(plan.status, 'Planning');
            assert.strictEqual(plan.subscription, 'AzCode2605');
            assert.strictEqual(plan.location, 'West US 2');
            assert.strictEqual(plan.locationCode, 'westus2');
            assert.strictEqual(plan.recipe, 'AZD (Bicep)');
            assert.strictEqual(plan.stack, 'Serverless (Functions Flex Consumption + Static Web Apps)');
            assert.strictEqual(findRow(plan.requirements, 'Budget'), 'Cost-Optimized');
            assert.deepStrictEqual(plan.workspaceScan.rows.map((r) => r[0]), ['api', 'web', 'shared']);
            assert.strictEqual(plan.resourcesHeading, 'Service Mapping');
            assert.strictEqual(plan.resources.rows.length, 4);
            assert.deepStrictEqual(plan.architecture.map((s) => s.title), ['Supporting Services']);
            assert.strictEqual(getDeploymentPlanRenderIssue('non-empty', plan), undefined);
        });

        test('scrapbook plan', () => {
            const plan = loadPlan(scrapbookProjectFolder);

            assert.strictEqual(plan.subscription, 'AzCode2605');
            assert.strictEqual(plan.locationCode, 'westus2');
            assert.strictEqual(plan.recipe, 'AZD (Bicep)');
            assert.strictEqual(plan.stack, 'Serverless + Static Web Apps');
            assert.deepStrictEqual(plan.workspaceScan.rows.map((r) => r[0]), [
                'scrapbook-api',
                'cleanup-worker',
                'scrapbook-web',
                'shared',
            ]);
            assert.strictEqual(plan.resources.rows.length, 5);
            assert.deepStrictEqual(plan.architecture.map((s) => s.title), ['Supporting Services']);
        });
    });
});

function loadPlan(workspaceFolderName: string): DeploymentPlanData {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'deployment-plan.md');
    return parseDeploymentPlanMarkdown(fs.readFileSync(fixtureUri.fsPath, 'utf8'));
}

function findRow(table: DeploymentPlanData['requirements'], attribute: string): string | undefined {
    return table?.rows.find((row) => row[0] === attribute)?.[1];
}
