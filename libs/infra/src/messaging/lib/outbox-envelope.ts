import { z } from 'zod';

export const outboxEnvelopeSchema = z.object({
  schemaVersion: z.number().int().min(1).optional(),
  eventId: z.string().min(1),
  occurredAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'not a parseable timestamp',
  }),
  payload: z.record(z.string(), z.unknown()),
});

export type OutboxEnvelope = z.infer<typeof outboxEnvelopeSchema>;

export function formatEnvelopeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
