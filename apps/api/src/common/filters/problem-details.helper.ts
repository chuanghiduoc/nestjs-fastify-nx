import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  errorTypeUrl,
  type ValidationErrorItemDto,
} from '@nestjs-fastify-nx/contracts';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const HTTP_STATUS_TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported Media Type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
};

export const HTTP_STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ERROR_CODES.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ERROR_CODES.INTERNAL_SERVER_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ERROR_CODES.REQUEST_TIMEOUT,
};

// Per-dependency health breakdown carried on a 503 from the health probes. RFC 9457 extension
// member — without it the filter would flatten a health failure to a bare "Service Unavailable"
// and the caller could not tell which dependency is down.
export type HealthChecks = Record<string, { status: string; message?: string }>;

export interface ProblemDetailsArgs {
  status: number;
  title: string;
  detail?: string;
  code: string;
  instance?: string;
  requestId?: string;
  errors?: ValidationErrorItemDto[];
  checks?: HealthChecks;
}

export interface ProblemDetailsBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  requestId?: string;
  timestamp: string;
  errors?: ValidationErrorItemDto[];
  checks?: HealthChecks;
}

export function buildProblemDetails(args: ProblemDetailsArgs): ProblemDetailsBody {
  const body: ProblemDetailsBody = {
    type: errorTypeUrl(args.code),
    title: args.title,
    status: args.status,
    detail: args.detail,
    instance: args.instance,
    code: args.code,
    requestId: args.requestId,
    timestamp: new Date().toISOString(),
  };
  if (args.errors && args.errors.length > 0) {
    body.errors = args.errors;
  }
  if (args.checks && Object.keys(args.checks).length > 0) {
    body.checks = args.checks;
  }
  return body;
}
