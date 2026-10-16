/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { allowCopilotOnRailsFrames } from '../../src/webviews/copilotOnRails/extension/controllers/CopilotOnRailsWebviewController';
import { userFeedbackFormEmbedUrl, userFeedbackFormUrl } from '../../src/webviews/copilotOnRails/shared/userFeedbackForm';

suite('Copilot on Rails user feedback form', () => {
    test('uses the Microsoft Forms response page rather than the design page', () => {
        const responseUrl = new URL(userFeedbackFormUrl);
        const embedUrl = new URL(userFeedbackFormEmbedUrl);

        assert.strictEqual(responseUrl.protocol, 'https:');
        assert.strictEqual(responseUrl.hostname, 'forms.cloud.microsoft');
        assert.strictEqual(responseUrl.pathname, '/Pages/ResponsePage.aspx');
        assert.ok(responseUrl.searchParams.get('id'));
        assert.strictEqual(responseUrl.searchParams.has('embed'), false);
        assert.strictEqual(embedUrl.searchParams.get('embed'), 'true');
    });

    test('adds only the required frame origins to the webview CSP', () => {
        const template = '<meta http-equiv="Content-Security-Policy" content="form-action \'none\'; default-src vscode-webview:;">';

        const updated = allowCopilotOnRailsFrames(template);

        assert.match(updated, /frame-src https:\/\/forms\.cloud\.microsoft https:\/\/forms\.office\.com http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*;/);
        assert.match(updated, /default-src vscode-webview:/);
    });
});
