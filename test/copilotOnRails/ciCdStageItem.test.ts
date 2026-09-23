/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { CiCdStageItem, ciCdSurveyUrl } from '../../src/tree/project/CiCdStageItem';

suite('CiCdStageItem', () => {
    test('shows the CI/CD stage with a survey action', () => {
        const stage = new CiCdStageItem(2);
        const stageItem = stage.getTreeItem();

        assert.strictEqual(stageItem.label, '4. CI/CD');
        assert.strictEqual(stageItem.description, 'Provide Feedback');

        const children = stage.getChildren();
        assert.strictEqual(children.length, 1);

        const surveyItem = children[0].getTreeItem();
        assert.strictEqual(surveyItem.label, 'Take survey');
        assert.strictEqual(surveyItem.command?.command, 'vscode.open');
        assert.strictEqual((surveyItem.command?.arguments?.[0] as vscode.Uri).toString(), ciCdSurveyUrl);
    });
});
