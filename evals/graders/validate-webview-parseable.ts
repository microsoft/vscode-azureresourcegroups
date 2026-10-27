/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Asserts the plan the agent wrote is renderable by the plan webview.
 *
 * This runs the extension's real `parseScaffoldPlanMarkdown` — the same function the
 * webview calls — rather than a lookalike, so a plan that passes here cannot fail to
 * render in product.
 */

import { parseScaffoldPlanMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown.ts';
import { fail, readArtifact, runGrader } from './graderHarness.ts';

runGrader('project-plan.md renders in the plan webview', () => {
    const plan = parseScaffoldPlanMarkdown(readArtifact('.azure/project-plan.md'));

    if (plan.parseError) {
        fail(`the webview parser rejected the plan: ${plan.parseError.message}`);
    }
    if (!plan.sections?.length) {
        fail('the webview parser returned zero sections — the plan view would render empty');
    }
    if (!plan.status) {
        fail('the webview parser could not extract the Status metadata row');
    }
});
