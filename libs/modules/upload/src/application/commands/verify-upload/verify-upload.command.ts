import { Command } from '@nestjs/cqrs';

export type VerifyUploadOutcome = 'verified' | 'rejected' | 'skipped';

// Dispatched by the worker for a quarantined object. It is a command rather than worker-local logic
// so the stored-file state machine has exactly one owner.
export class VerifyUploadCommand extends Command<VerifyUploadOutcome> {
  constructor(
    readonly key: string,
    readonly declaredContentType: string,
    readonly bucket: string,
    readonly correlationId?: string,
  ) {
    super();
  }
}
