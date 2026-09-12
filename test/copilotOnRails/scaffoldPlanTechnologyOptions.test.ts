/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { ScaffoldPlanSection } from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import {
    isAzureFunctionsFramework,
    isBackendServiceSection,
} from '../../src/webviews/copilotOnRails/views/utils/scaffoldPlanTechnologyOptions';

suite('scaffold plan technology options', () => {
    test('recognizes backend sections from their framework', () => {
        for (const framework of ['Azure Functions', 'Express', 'Fastify', 'FastAPI']) {
            assert.strictEqual(isBackendServiceSection(serviceSection('Application', framework)), true);
        }
    });

    test('does not classify frontend framework sections as backend', () => {
        assert.strictEqual(
            isBackendServiceSection(serviceSection('Attendance Web App', 'React + Vite')),
            false,
        );
    });

    test('uses the section title when the framework is unfamiliar', () => {
        assert.strictEqual(
            isBackendServiceSection(serviceSection('Attendance API', 'Custom HTTP host')),
            true,
        );
        assert.strictEqual(
            isBackendServiceSection(serviceSection('Attendance API', 'None')),
            true,
        );
    });

    test('only Azure Functions variants are fully supported backend frameworks', () => {
        assert.strictEqual(isAzureFunctionsFramework('Azure Functions'), true);
        assert.strictEqual(isAzureFunctionsFramework('Azure Functions v4 (Node.js v4 model)'), true);
        assert.strictEqual(isAzureFunctionsFramework('Express'), false);
    });
});

function serviceSection(title: string, framework: string): ScaffoldPlanSection {
    return {
        number: 2,
        title,
        content: [{
            type: 'table',
            headers: ['Component', 'Technology'],
            rows: [
                ['Language', 'TypeScript'],
                ['Framework', framework],
            ],
        }],
    };
}
