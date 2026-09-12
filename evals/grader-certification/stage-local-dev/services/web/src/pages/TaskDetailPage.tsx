// Task detail page - two-column layout with media + metadata

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Title2,
  Body1,
  Caption1,
  Text,
  Badge,
  Spinner,
  MessageBar,
  MessageBarBody,
  Image,
} from '@fluentui/react-components';
import { ArrowLeftRegular, AttachRegular, CalendarRegular, ClockRegular } from '@fluentui/react-icons';
import { api } from '../api';
import type { Task } from '../types';

const statusColors = {
  'Not started': 'subtle',
  'In progress': 'brand',
  'Done': 'success',
} as const;

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTask = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        setError(null);
        const data = await api.getTask(id);
        setTask(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task');
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Spinner size="extra-large" label="Loading task..." />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <Button
          icon={<ArrowLeftRegular />}
          appearance="subtle"
          onClick={() => navigate('/')}
          style={{ marginBottom: '16px' }}
        >
          Back to Tasks
        </Button>
        <MessageBar intent="error">
          <MessageBarBody>
            <strong>Error:</strong> {error || 'Task not found'}
          </MessageBarBody>
        </MessageBar>
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Back button */}
      <Button
        icon={<ArrowLeftRegular />}
        appearance="subtle"
        onClick={() => navigate('/')}
        style={{ marginBottom: '24px' }}
      >
        Back to Tasks
      </Button>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left column - Media */}
        <Card style={{ border: '1px solid #E1E4E8', borderRadius: '4px' }}>
          {task.attachmentUrl ? (
            <div>
              <Image
                src={task.attachmentUrl}
                alt={task.attachmentName || 'Attachment'}
                fit="cover"
                style={{ width: '100%', height: '400px', borderRadius: '4px 4px 0 0' }}
              />
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7A5AF8' }}>
                  <AttachRegular fontSize={20} />
                  <Text weight="semibold">{task.attachmentName}</Text>
                </div>
                <Caption1 style={{ color: '#6B7280', marginTop: '4px' }}>
                  {formatSize(task.attachmentSize)}
                </Caption1>
              </div>
            </div>
          ) : (
            <div
              style={{
                height: '400px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#F7F8FA',
                color: '#6B7280',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <AttachRegular fontSize={48} />
                <Body1 style={{ marginTop: '8px' }}>No attachment</Body1>
              </div>
            </div>
          )}
        </Card>

        {/* Right column - Metadata */}
        <Card style={{ border: '1px solid #E1E4E8', borderRadius: '4px', padding: '24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <Badge appearance="outline" color={statusColors[task.status]} size="large">
              {task.status}
            </Badge>
          </div>

          <Title2 style={{ color: '#1B1E23', marginBottom: '24px' }}>
            {task.title}
          </Title2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <CalendarRegular fontSize={20} style={{ color: '#2F6FEB' }} />
              <div>
                <Caption1 style={{ color: '#6B7280', display: 'block' }}>Due Date</Caption1>
                <Text weight="semibold" style={{ color: '#1B1E23' }}>
                  {formatDate(task.dueDate)}
                </Text>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ClockRegular fontSize={20} style={{ color: '#2F6FEB' }} />
              <div>
                <Caption1 style={{ color: '#6B7280', display: 'block' }}>Created</Caption1>
                <Body1 style={{ color: '#1B1E23' }}>
                  {formatDate(task.createdAt)}
                </Body1>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ClockRegular fontSize={20} style={{ color: '#2F6FEB' }} />
              <div>
                <Caption1 style={{ color: '#6B7280', display: 'block' }}>Last Updated</Caption1>
                <Body1 style={{ color: '#1B1E23' }}>
                  {formatDate(task.updatedAt)}
                </Body1>
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #E1E4E8' }}>
            <Button
              appearance="primary"
              style={{ width: '100%', background: '#2F6FEB' }}
            >
              Edit Task
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
