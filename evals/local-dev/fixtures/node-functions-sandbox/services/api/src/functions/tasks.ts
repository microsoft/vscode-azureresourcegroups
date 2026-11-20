/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { pool } from '../db';

interface CreateTaskBody {
    title: string;
}

function isCreateTaskBody(value: unknown): value is CreateTaskBody {
    return typeof value === 'object'
        && value !== null
        && typeof (value as { title?: unknown }).title === 'string'
        && (value as { title: string }).title.trim().length > 0;
}

export async function listTasks(): Promise<HttpResponseInit> {
    const result = await pool.query<{ id: number; title: string; completed: boolean }>(
        'SELECT id, title, completed FROM tasks ORDER BY id',
    );
    return { jsonBody: { items: result.rows } };
}

export async function createTask(request: HttpRequest): Promise<HttpResponseInit> {
    const body: unknown = await request.json();
    if (!isCreateTaskBody(body)) {
        return { status: 400, jsonBody: { error: 'A non-empty title is required.' } };
    }

    const result = await pool.query<{ id: number; title: string; completed: boolean }>(
        'INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, completed',
        [body.title.trim()],
    );
    return { status: 201, jsonBody: { item: result.rows[0] } };
}

app.http('listTasks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tasks',
    handler: listTasks,
});

app.http('createTask', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'tasks',
    handler: createTask,
});
