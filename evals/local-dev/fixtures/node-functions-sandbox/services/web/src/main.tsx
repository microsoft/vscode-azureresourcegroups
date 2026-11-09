/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

interface Task {
    id: number;
    title: string;
    completed: boolean;
}

function App(): React.JSX.Element {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [status, setStatus] = useState('Loading API...');

    useEffect(() => {
        Promise.all([
            fetch('/api/health').then(response => response.json()),
            fetch('/api/tasks').then(response => response.json()),
        ]).then(([health, taskResponse]) => {
            setStatus(health.status === 'ok' ? 'Sandbox ready' : 'Sandbox unavailable');
            setTasks(taskResponse.items);
        }).catch(error => {
            setStatus(error instanceof Error ? error.message : 'Request failed');
        });
    }, []);

    return (
        <main>
            <p className="eyebrow">Copilot on Rails fixture</p>
            <h1>Node 22 + Azure Functions sandbox</h1>
            <p className="status">{status}</p>
            <section>
                <h2>Tasks from PostgreSQL</h2>
                {tasks.length === 0
                    ? <p>No tasks yet. POST a title to <code>/api/tasks</code>.</p>
                    : <ul>{tasks.map(task => <li key={task.id}>{task.title}</li>)}</ul>}
            </section>
        </main>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
