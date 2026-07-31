import { STATUS_CODES } from 'node:http';
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
  [HttpStatus.REQUEST_TIMEOUT]: 'Request Timeout',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
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
  [HttpStatus.REQUEST_TIMEOUT]: ERROR_CODES.REQUEST_TIMEOUT,
  [HttpStatus.NOT_IMPLEMENTED]: ERROR_CODES.NOT_IMPLEMENTED,
  [HttpStatus.BAD_GATEWAY]: ERROR_CODES.SERVICE_UNAVAILABLE,
};

/**
 * RFC 9457 §3.1: `title` is a short, human-readable summary of the problem type. A status this map
 * does not list still needs one, and Node already ships every registered reason phrase — falling
 * back to a literal "Error" would ship a title that describes nothing.
 */
export function statusTitle(status: number): string {
  return HTTP_STATUS_TITLES[status] ?? STATUS_CODES[status] ?? 'Error';
}

/**
 * A status outside the mapped set still must not be described with a code from the wrong class:
 * answering a 501 with `internal_server_error` tells the client to retry a route that will never
 * work. Fall back to the generic code of the status class instead.
 */
export function statusCode(status: number): string {
  return (
    HTTP_STATUS_CODES[status] ??
    (status >= HttpStatus.INTERNAL_SERVER_ERROR
      ? ERROR_CODES.INTERNAL_SERVER_ERROR
      : ERROR_CODES.BAD_REQUEST)
  );
}

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
    const errors = args.errors
      .filter(
        (item) =>
          typeof item?.path === 'string' &&
          typeof item?.code === 'string' &&
          typeof item?.message === 'string',
      )
      .map((item) => ({
        path: item.path,
        code: item.code,
        message: item.message,
        ...(typeof item.messageKey === 'string' ? { messageKey: item.messageKey } : {}),
        ...(typeof item.rule === 'string' ? { rule: item.rule } : {}),
        ...(item.constraint &&
        typeof item.constraint === 'object' &&
        !Array.isArray(item.constraint)
          ? { constraint: item.constraint }
          : {}),
      }));
    if (errors.length > 0) body.errors = errors;
  }
  if (args.checks && Object.keys(args.checks).length > 0) {
    body.checks = Object.fromEntries(
      Object.entries(args.checks)
        .filter(([, check]) => typeof check?.status === 'string')
        // Dependency names and states are enough for health automation. A provider/driver message
        // is not, and accepting it here would create a second 5xx detail channel.
        .map(([name, check]) => [name, { status: check.status }]),
    );
  }
  return body;
}
