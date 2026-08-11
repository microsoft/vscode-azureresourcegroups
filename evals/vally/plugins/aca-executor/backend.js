/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- Vally imports this CommonJS bridge from plain Node. */

'use strict';

require('tsx/cjs');

const plugin = require('../../../src/vallyAcaExecutor.ts');

module.exports = {
    registerBackends: plugin.registerBackends,
};
