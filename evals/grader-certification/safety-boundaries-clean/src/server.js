/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const express = require('express');
const app = express();
// Secrets come from Key Vault, never from source.
const apiKey = process.env.API_KEY;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
module.exports = app;

