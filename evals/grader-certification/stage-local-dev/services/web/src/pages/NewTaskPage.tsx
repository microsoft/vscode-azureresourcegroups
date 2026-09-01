// New task page - form with validation

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Title2,
  Field,
  Input,
  Combobox,
  Option,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { ArrowLeftRegular, AddRegular } from '@fluentui/react-icons';
import { api } from '../api';
import type { TaskStatus } from '../types';

const statusOptions: TaskStatus[] = ['Not started', 'In progress', 'Done'];

export function NewTaskPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TaskStatus>('Not started');
  const [dueDate, setDueDate] = useState(() => {
    // Default to 7 days from now
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
  });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setTitleError(null);

    // Validation
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }

    if (title.length < 3) {
      setTitleError('Title must be at least 3 characters');
      return;
    }

    try {
      setLoading(true);
      await api.createTask({
        title: title.trim(),
        status,
        dueDate,
        attachment: attachment || undefined,
      });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Back button */}
      <Button
        icon={<ArrowLeftRegular />}
        appearance="subtle"
        onClick={() => navigate('/')}
        style={{ marginBottom: '24px' }}
      >
        Back to Tasks
      </Button>

      <Card style={{ border: '1px solid #E1E4E8', borderRadius: '4px', padding: '32px' }}>
        <Title2 style={{ color: '#1B1E23', marginBottom: '24px' }}>
          Create New Task
        </Title2>

        {error && (
          <MessageBar intent="error" style={{ marginBottom: '24px' }}>
            <MessageBarBody>
              <strong>Error:</strong> {error}
            </MessageBarBody>
          </MessageBar>
        )}

        <form onSubmit={handleSubmit}>
          <Field
            label="Title"
            required
            validationState={titleError ? 'error' : 'none'}
            validationMessage={titleError || undefined}
            style={{ marginBottom: '20px' }}
          >
            <Input
              value={title}
              onChange={(_, data) => {
                setTitle(data.value);
                setTitleError(null);
              }}
              placeholder="Enter task title"
              disabled={loading}
            />
          </Field>

          <Field label="Status" required style={{ marginBottom: '20px' }}>
            <Combobox
              value={status}
              onOptionSelect={(_, data) => setStatus(data.optionValue as TaskStatus)}
              disabled={loading}
            >
              {statusOptions.map(opt => (
                <Option key={opt} value={opt}>
                  {opt}
                </Option>
              ))}
            </Combobox>
          </Field>

          <Field label="Due Date" required style={{ marginBottom: '20px' }}>
            <Input
              type="date"
              value={dueDate}
              onChange={(_, data) => setDueDate(data.value)}
              disabled={loading}
            />
          </Field>

          <Field
            label="Attachment"
            hint="Optional - attach a file to this task"
            style={{ marginBottom: '32px' }}
          >
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setAttachment(file || null);
              }}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #E1E4E8',
                borderRadius: '4px',
                fontFamily: 'inherit',
              }}
            />
          </Field>

          <div style={{ display: 'flex', gap: '12px' }}>
            <Button
              appearance="primary"
              icon={<AddRegular />}
              type="submit"
              disabled={loading}
              style={{ background: '#2F6FEB' }}
            >
              {loading ? 'Creating...' : 'Create Task'}
            </Button>
            <Button
              appearance="secondary"
              onClick={() => navigate('/')}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
