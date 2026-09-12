// Mock data matching the approved project plan Sample Content

import type { Task } from '../types';

export const mockTasks: Task[] = [
  {
    id: '1',
    title: 'Renew SSL certificate',
    status: 'In progress',
    dueDate: '2026-09-04',
    attachmentName: 'renewal.pdf',
    attachmentSize: 412 * 1024, // 412 KB
    attachmentUrl: 'https://images.unsplash.com/photo-1554224311-beee0c58a3c6?w=400&h=300&fit=crop', // Document image
    createdAt: '2026-08-25T10:00:00Z',
    updatedAt: '2026-08-30T14:30:00Z',
  },
  {
    id: '2',
    title: 'Migrate staging database',
    status: 'Not started',
    dueDate: '2026-09-11',
    createdAt: '2026-08-26T09:15:00Z',
    updatedAt: '2026-08-26T09:15:00Z',
  },
  {
    id: '3',
    title: 'Write incident postmortem',
    status: 'Done',
    dueDate: '2026-08-29',
    attachmentName: 'timeline.png',
    attachmentSize: 234 * 1024, // 234 KB
    attachmentUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=400&fit=crop', // Timeline/chart image
    createdAt: '2026-08-20T16:00:00Z',
    updatedAt: '2026-08-29T11:45:00Z',
  },
  {
    id: '4',
    title: 'Audit blob retention policy',
    status: 'Not started',
    dueDate: '2026-09-18',
    createdAt: '2026-08-27T13:20:00Z',
    updatedAt: '2026-08-27T13:20:00Z',
  },
];
