import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Task } from '../types';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api.getTasks().then(setTasks).catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <ul>
      {tasks.map(task => (
        <li key={task.id}>
          {task.title} — {task.status}
        </li>
      ))}
    </ul>
  );
}
