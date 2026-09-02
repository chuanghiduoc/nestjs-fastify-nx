import { HttpException, HttpStatus } from '@nestjs/common';
import { isDomainException } from '@nestjs-fastify-nx/core';
import { GraphQLError } from 'graphql';
import { defaultErrorFormatter } from 'mercurius';
import type { MercuriusContext } from 'mercurius';
import type { ExecutionResult } from 'graphql';

const MASKED_MESSAGE = 'Internal server error';
const MERCURIUS_REQUEST_ERROR_CODE_PREFIX = 'MER_ERR_GQL_';

type Execution = ExecutionResult & Required<Pick<ExecutionResult, 'errors'>>;

function isMercuriusClientError(original: Error): boolean {
  const { code, statusCode } = original as Error & { code?: unknown; statusCode?: unknown };
  return (
    typeof code === 'string' &&
    code.startsWith(MERCURIUS_REQUEST_ERROR_CODE_PREFIX) &&
    typeof statusCode === 'number' &&
    statusCode < HttpStatus.INTERNAL_SERVER_ERROR
  );
}

// Same rule GlobalExceptionFilter applies to REST. A GraphQL-level error (syntax, validation) has
// no originalError and only describes the client's own query, so it is not internal.
function isInternalFailure(error: GraphQLError): boolean {
  const original = error.originalError;
  if (!original) return false;
  // A domain failure is raised for the client to act on and never denotes an internal fault, so it
  // is readable here without being an HttpException — the transport, not the domain, owns status.
  if (isDomainException(original)) return false;
  if (isMercuriusClientError(original)) return false;
  if (original instanceof HttpException) {
    return original.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR;
  }
  return true;
}

// originalError is dropped deliberately — carrying it forward puts the message back into the
// serialized error.
function mask(error: GraphQLError): GraphQLError {
  return new GraphQLError(MASKED_MESSAGE, {
    nodes: error.nodes,
    source: error.source,
    positions: error.positions,
    path: error.path,
    // Extensions are serialized too and may contain exception.response, cause, stacktrace, or
    // adapter metadata. Rebuild them instead of preserving the source.
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  });
}

/**
 * Mercurius' default formatter serializes every error's `message` verbatim, so without this an
 * unexpected resolver failure answers a GraphQL client with the raw
 * message while REST answers "Internal Server Error".
 *
 * Masking runs before delegating because the default formatter serializes eagerly and flattens
 * nested validation errors — afterwards there is no `originalError` left to judge by. Logs are
 * unaffected: GlobalExceptionFilter already logged and reported the error before re-throwing here.
 */
export function createGraphqlErrorFormatter() {
  return (execution: Execution, context: MercuriusContext) => {
    const errors = execution.errors.map((error) =>
      isInternalFailure(error) ? mask(error) : error,
    );
    return defaultErrorFormatter({ ...execution, errors }, context);
  };
}
