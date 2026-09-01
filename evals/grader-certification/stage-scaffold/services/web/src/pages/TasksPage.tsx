// Tasks list page - main task list with header + action bar

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Title3,
  Body1,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import { AddRegular } from '@fluentui/react-icons';
import { api } from '../api';
import type { Task } from '../types';
import { TaskCard } from '../components/TaskCard';

export function TasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getTasks();
      setTasks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <Skeleton>
            <SkeletonItem size={32} />
          </Skeleton>
        </div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ marginBottom: '12px' }}>
            <Skeleton>
              <SkeletonItem size={64} />
            </Skeleton>
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <MessageBar intent="error">
          <MessageBarBody>
            <strong>Error:</strong> {error}
          </MessageBarBody>
        </MessageBar>
        <Button
          appearance="primary"
          onClick={loadTasks}
          style={{ marginTop: '16px' }}
        >
          Retry
        </Button>
      </div>
    );
  }

  // Empty state
  if (tasks.length === 0) {
    return (
      <div style={{ padding: '48px 24px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <Card
          style={{
            padding: '48px 32px',
            border: '1px solid #E1E4E8',
            borderRadius: '8px',
          }}
        >
          <div style={{ marginBottom: '16px', fontSize: '64px' }}>📋</div>
          <Title3 style={{ marginBottom: '8px', color: '#1B1E23' }}>
            No tasks yet
          </Title3>
          <Body1 style={{ color: '#6B7280', marginBottom: '24px' }}>
            Create your first task to get started with tracking your work.
          </Body1>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={() => navigate('/tasks/new')}
          >
            Create Task
          </Button>
        </Card>
      </div>
    );
  }

  // Data state
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <Title3 style={{ color: '#1B1E23', margin: 0 }}>Tasks</Title3>
          <Body1 style={{ color: '#6B7280', marginTop: '4px' }}>
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
          </Body1>
        </div>
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => navigate('/tasks/new')}
          style={{ background: '#2F6FEB' }}
        >
          Create Task
        </Button>
      </div>

      {/* Task list */}
      <div>
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
