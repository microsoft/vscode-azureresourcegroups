/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const readJson = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const tasks = readJson('.vscode/tasks.json').tasks;
const launch = readJson('.vscode/launch.json');
const extensions = readJson('.vscode/extensions.json');
const serializedConfig = JSON.stringify({ tasks, launch, extensions }).toLowerCase();
const workspaceFolder = '$' + '{workspaceFolder}';

for (const forbidden of ['ms-vscode-remote.remote-containers', '.devcontainer', 'reopen in container']) {
    if (serializedConfig.includes(forbidden)) {
        throw new Error(`Host-workspace F5 configuration must not reference ${forbidden}.`);
    }
}

const commandFor = label => tasks.find(task => task.label === label)?.command;
if (commandFor('sandbox: up') !== 'docker compose up --build --wait dev') {
    throw new Error('sandbox: up must build and wait for the Compose dev service.');
}
if (!commandFor('sandbox: api')?.includes('docker compose exec -T')
    || !commandFor('sandbox: api')?.includes('dev npm run dev:api')) {
    throw new Error('sandbox: api must run the API inside the Compose dev service.');
}
if (!commandFor('sandbox: web')?.includes('docker compose exec -T dev npm run dev:web')) {
    throw new Error('sandbox: web must run the frontend inside the Compose dev service.');
}
if (commandFor('sandbox: down') !== 'docker compose down --remove-orphans') {
    throw new Error('sandbox: down must tear down the Compose stack.');
}

const api = launch.configurations.find(configuration => configuration.name === 'Sandbox API (debug)');
if (api?.type !== 'node'
    || api.request !== 'attach'
    || api.port !== 9229
    || api.sourceMaps !== true
    || api.localRoot !== `${workspaceFolder}/services/api`
    || api.remoteRoot !== '/workspaces/copilot-on-rails-sandbox/services/api'
    || api.preLaunchTask !== 'sandbox: api'
    || api.postDebugTask !== 'sandbox: down') {
    throw new Error('Sandbox API debug configuration must attach from the host with source mapping and teardown.');
}

const web = launch.configurations.find(configuration => configuration.name === 'Sandbox Web (debug)');
if (web?.type !== 'chrome'
    || web.request !== 'launch'
    || web.url !== 'http://localhost:5173'
    || web.webRoot !== `${workspaceFolder}/services/web`
    || web.preLaunchTask !== 'sandbox: web'
    || web.postDebugTask !== 'sandbox: down') {
    throw new Error('Sandbox Web debug configuration must launch the forwarded host URL and teardown.');
}

const compound = launch.compounds.find(configuration => configuration.name === 'Sandbox: F5');
if (!compound
    || !compound.configurations.includes('Sandbox API (debug)')
    || !compound.configurations.includes('Sandbox Web (debug)')
    || compound.stopAll !== true) {
    throw new Error('Sandbox: F5 must start and stop the API and frontend together.');
}
