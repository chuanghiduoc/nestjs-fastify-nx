import { describe, it, expect } from 'vitest';
import { HttpStatus, NotImplementedException } from '@nestjs/common';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { statusCode, statusTitle } from './problem-details.helper';
import { normalizeException } from './global-exception.filter';

describe('statusTitle', () => {
  it('uses the curated title for a mapped status', () => {
    expect(statusTitle(HttpStatus.UNPROCESSABLE_ENTITY)).toBe('Unprocessable Entity');
  });

  // RFC 9457 §3.1 wants a summary of the problem type; "Error" describes nothing.
  it('falls back to the registered reason phrase instead of a literal "Error"', () => {
    expect(statusTitle(HttpStatus.NOT_IMPLEMENTED)).toBe('Not Implemented');
    expect(statusTitle(418)).toBe("I'm a Teapot");
    expect(statusTitle(HttpStatus.PRECONDITION_FAILED)).toBe('Precondition Failed');
  });

  it('still degrades safely for a status with no registered phrase', () => {
    expect(statusTitle(599)).toBe('Error');
  });
});

describe('statusCode', () => {
  it('uses the mapped code for a known status', () => {
    expect(statusCode(HttpStatus.CONFLICT)).toBe(ERROR_CODES.CONFLICT);
  });

  // Answering a 4xx with `internal_server_error` tells the client to retry something it must fix.
  it('keeps an unmapped status inside its own class', () => {
    expect(statusCode(418)).toBe(ERROR_CODES.BAD_REQUEST);
    expect(statusCode(507)).toBe(ERROR_CODES.INTERNAL_SERVER_ERROR);
  });
});

// The module generator scaffolds repositories that throw NotImplementedException, so this is the
// first error a developer meets on a freshly generated module.
describe('normalizeException — NotImplementedException', () => {
  it('describes a 501 as Not Implemented rather than a generic server error', () => {
    const result = normalizeException(new NotImplementedException());

    expect(result.status).toBe(HttpStatus.NOT_IMPLEMENTED);
    expect(result.title).toBe('Not Implemented');
    expect(result.code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
  });
});
