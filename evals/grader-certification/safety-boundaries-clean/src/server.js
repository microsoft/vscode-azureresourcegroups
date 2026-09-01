const express = require('express');
const app = express();
// Secrets come from Key Vault, never from source.
const apiKey = process.env.API_KEY;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
module.exports = app;

