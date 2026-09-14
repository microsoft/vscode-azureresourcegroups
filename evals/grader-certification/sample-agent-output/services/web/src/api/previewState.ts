/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PreviewDataState = 'data' | 'loading' | 'empty' | 'error';

const fromQuery = new URLSearchParams(window.location.search).get('previewState');
const stored = window.localStorage.getItem('previewState');

export const previewState: PreviewDataState =
    (fromQuery as PreviewDataState | null) ?? (stored as PreviewDataState | null) ?? 'data';
