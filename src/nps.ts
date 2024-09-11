/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { env, ExtensionContext, Uri, window } from 'vscode';
import * as nls from 'vscode-nls';
import { ext } from './extensionVariables';

const localize = nls.loadMessageBundle();

const NPS_SURVEY_URL = 'https://www.surveymonkey.com/r/SMQM3DH';

const PROBABILITY = 0.15;
const SESSION_COUNT_KEY = 'nps/sessionCount';
const LAST_SESSION_DATE_KEY = 'nps/lastSessionDate';
const SKIP_VERSION_KEY = 'nps/skipVersion';
const IS_CANDIDATE_KEY = 'nps/isCandidate';

export function survey({ globalState }: ExtensionContext): void {
    void callWithTelemetryAndErrorHandling('azureResourceGroups.nps.survey', async (context: IActionContext) => {
        if (env.language !== 'en' && !env.language.startsWith('en-')) {
            return;
        }

        const skipVersion = globalState.get(SKIP_VERSION_KEY, '');
        if (skipVersion) {
            return;
        }

        const date = new Date().toDateString();
        const lastSessionDate = globalState.get(LAST_SESSION_DATE_KEY, new Date(0).toDateString());

        if (date === lastSessionDate) {
            return;
        }

        const sessionCount = globalState.get(SESSION_COUNT_KEY, 0) + 1;
        await globalState.update(LAST_SESSION_DATE_KEY, date);
        await globalState.update(SESSION_COUNT_KEY, sessionCount);

        if (sessionCount < 9) {
            return;
        }

        const isCandidate = true || globalState.get(IS_CANDIDATE_KEY, false)
            || Math.random() < PROBABILITY;

        await globalState.update(IS_CANDIDATE_KEY, isCandidate);

        const extensionVersion = (ext.context.extension.packageJSON as { version: string }).version;
        if (!isCandidate) {
            await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            return;
        }

        const take = {
            title: localize('azureResourceGroups.takeSurvey', "Take Survey"),
            run: async () => {
                context.telemetry.properties.takeShortSurvey = 'true';
                void env.openExternal(Uri.parse(`${NPS_SURVEY_URL}?o=${encodeURIComponent(process.platform)}&v=${encodeURIComponent(extensionVersion)}&m=${encodeURIComponent(env.machineId)}`));
                await globalState.update(IS_CANDIDATE_KEY, false);
                await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            }
        };
        const remind = {
            title: localize('azureResourceGroups.remindLater', "Remind Me Later"),
            run: async () => {
                context.telemetry.properties.remindMeLater = 'true';
                await globalState.update(SESSION_COUNT_KEY, sessionCount - 3);
            }
        };
        const never = {
            title: localize('azureResourceGroups.neverAgain', "Don't Show Again"),
            isSecondary: true,
            run: async () => {
                context.telemetry.properties.dontShowAgain = 'true';
                await globalState.update(IS_CANDIDATE_KEY, false);
                await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            }
        };

        context.telemetry.properties.userAsked = 'true';
        const button = await window.showInformationMessage(localize('azureResourceGroups.surveyQuestion', "Do you mind taking a quick feedback survey about the Azure Extensions for VS Code?"), take, remind, never);
        await (button || remind).run();
    });
}
