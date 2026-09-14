/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `host` + `allowedHosts` + `strictPort` keep the dev server reachable and framable
// by the Approve UI preview webview.
export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        allowedHosts: true,
        strictPort: false,
    },
});
