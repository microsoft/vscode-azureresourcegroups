/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    getDeploymentPlanRenderIssue,
    parseDeploymentPlanMarkdown,
} from '../src/webviews/copilotOnRails/views/utils/parseDeploymentPlanMarkdown';

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
});
