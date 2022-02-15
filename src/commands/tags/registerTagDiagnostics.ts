/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, registerEvent } from "@microsoft/vscode-azext-utils";
import { Diagnostic, languages, TextDocument, TextDocumentChangeEvent, TextEditor, window, workspace } from "vscode";
import { ext } from "../../extensionVariables";
import { getTagDiagnostics } from "./getTagDiagnostics";
import { TagFileSystem } from "./TagFileSystem";

export function registerTagDiagnostics(): void {
    ext.diagnosticCollection = languages.createDiagnosticCollection('Azure Tags');
    ext.context.subscriptions.push(ext.diagnosticCollection);

    registerEvent('onDidChangeActiveTextEditor', window.onDidChangeActiveTextEditor, onDidChangeActiveTextEditor);
}

function onDidChangeActiveTextEditor(context: IActionContext, editor: TextEditor | undefined): void {
    context.telemetry.suppressIfSuccessful = true;
    context.errorHandling.suppressDisplay = true;

    if (editor?.document.uri.scheme === TagFileSystem.scheme) {
        if (!ext.diagnosticWatcher) {
            ext.diagnosticWatcher = workspace.onDidChangeTextDocument(onDidChangeTextDocument);
        }
        updateTagDiagnostics(editor.document);
    } else if (ext.diagnosticWatcher) {
        ext.diagnosticWatcher.dispose();
        ext.diagnosticWatcher = undefined;
        ext.diagnosticCollection.clear();
    }
}

async function onDidChangeTextDocument(e: TextDocumentChangeEvent): Promise<void> {
    await callWithTelemetryAndErrorHandling('onDidChangeTextDocument', context => {
        context.telemetry.suppressIfSuccessful = true;
        context.errorHandling.suppressDisplay = true;

        if (e.contentChanges.length > 0 && e.document.uri.scheme === TagFileSystem.scheme) {
            updateTagDiagnostics(e.document);
        }
    });
}

function updateTagDiagnostics(document: TextDocument): void {
    const diagnostics: Diagnostic[] = getTagDiagnostics(document.getText());
    ext.diagnosticCollection.set(document.uri, diagnostics);
}
