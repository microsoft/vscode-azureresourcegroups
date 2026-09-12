// Validation schemas using Zod
import { z } from 'zod';

export const TaskStatusSchema = z.enum(['not-started', 'in-progress', 'done']);

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  status: TaskStatusSchema.optional().default('not-started'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: TaskStatusSchema.optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const TaskIdSchema = z.string().uuid();

// Inferred request types
export type CreateTaskRequest = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskSchema>;
