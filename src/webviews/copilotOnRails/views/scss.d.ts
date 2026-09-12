/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ambient module declarations for SCSS side-effect imports used by the Copilot on Rails
// React views. The actual styles are bundled by `esbuild.copilotOnRailsViews.mjs`'s sass plugin;
// this declaration only exists so `tsc` recognizes the import.
declare module '*.scss';
