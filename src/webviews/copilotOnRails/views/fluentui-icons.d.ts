/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `@fluentui/react-icons` v2.0.x advertises `typings: lib/index.d.ts` in its
// package.json but does not actually ship a `.d.ts` file in `lib/`. Declare it
// as a wildcard module so the webview's icon imports type-check as `any`.
declare module '@fluentui/react-icons';
