/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, HttpResponseInit, InvocationContext } from '@azure/functions';
import { BlobServiceClient } from '@azure/storage-blob';
import { pool } from '../db';

const storageConnectionString = process.env.AzureWebJobsStorage;

if (!storageConnectionString) {
    throw new Error('AzureWebJobsStorage is required.');
}

const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);

export async function health(_request: unknown, context: InvocationContext): Promise<HttpResponseInit> {
    await Promise.all([
        blobServiceClient.getProperties(),
        pool.query('SELECT 1'),
    ]);
    context.log('Sandbox dependencies are ready.');

    return {
        jsonBody: {
            status: 'ok',
            services: {
                azurite: 'ready',
                postgres: 'ready',
            },
        },
    };
}

app.http('health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'health',
    handler: health,
});
