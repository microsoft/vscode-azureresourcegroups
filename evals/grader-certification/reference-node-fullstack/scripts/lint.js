'use strict';

const fs = require('node:fs');
const path = require('node:path');

for (const relativePath of ['src/server.js', 'public/app.js', 'test/server.test.js']) {
    const content = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    if (content.includes('\t') || / +$/m.test(content)) {
        throw new Error(`${relativePath} contains tabs or trailing whitespace`);
    }
}
