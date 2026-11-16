export const UPLOAD_VERIFICATION_DISPATCHER = Symbol('UPLOAD_VERIFICATION_DISPATCHER');

export interface UploadVerificationRequest {
  key: string;
  declaredContentType: string;
  bucket: string;
  correlationId?: string;
}

// Application stays free of BullMQ: the api binds this to the queue, and a test binds it to a spy.
export interface UploadVerificationDispatcher {
  dispatch(request: UploadVerificationRequest): Promise<void>;
}
