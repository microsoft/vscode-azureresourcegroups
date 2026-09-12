// Task card component for list view

import { Card, CardHeader, Badge, Text } from '@fluentui/react-components';
import { AttachRegular } from '@fluentui/react-icons';
import type { Task } from '../types';
import { useNavigate } from 'react-router-dom';

interface TaskCardProps {
  task: Task;
}

const statusColors = {
  'Not started': 'subtle',
  'In progress': 'brand',
  'Done': 'success',
} as const;

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return `in ${diffDays}d`;
  };

  return (
    <Card
      onClick={() => navigate(`/tasks/${task.id}`)}
      style={{
        cursor: 'pointer',
        border: '1px solid #E1E4E8',
        borderRadius: '4px',
        marginBottom: '8px',
      }}
    >
      <CardHeader
        header={
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
            <Text weight="semibold" style={{ flex: 1, color: '#1B1E23' }}>
              {task.title}
            </Text>
            {task.attachmentName && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#7A5AF8' }}>
                <AttachRegular fontSize={16} />
                <Text size={200} style={{ color: '#6B7280' }}>
                  {task.attachmentName}
                </Text>
              </div>
            )}
            <Badge appearance="outline" color={statusColors[task.status]}>
              {task.status}
            </Badge>
            <Text size={200} style={{ color: '#6B7280', minWidth: '80px', textAlign: 'right' }}>
              {formatDate(task.dueDate)}
            </Text>
          </div>
        }
      />
    </Card>
  );
}
