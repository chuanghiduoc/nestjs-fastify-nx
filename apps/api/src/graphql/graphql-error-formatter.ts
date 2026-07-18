import { HttpException, HttpStatus } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { defaultErrorFormatter } from 'mercurius';
import type { MercuriusContext } from 'mercurius';
import type { ExecutionResult } from 'graphql';

const MASKED_MESSAGE = 'Internal server error';

type Execution = ExecutionResult & Required<Pick<ExecutionResult, 'errors'>>;

// Same rule GlobalExceptionFilter applies to REST. A GraphQL-level error (syntax, validation) has
// no originalError and only describes the client's own query, so it is not internal.
function isInternalFailure(error: GraphQLError): boolean {
  const original = error.originalError;
  if (!original) return false;
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
    extensions: error.extensions,
  });
}

/**
 * Mercurius' default formatter serializes every error's `message` verbatim and has no production
 * masking, so without this an unexpected resolver failure answers a GraphQL client with the raw
 * message while REST answers "Internal Server Error".
 *
 * Masking runs before delegating because the default formatter serializes eagerly and flattens
 * nested validation errors — afterwards there is no `originalError` left to judge by. Logs are
 * unaffected: GlobalExceptionFilter already logged and reported the error before re-throwing here.
 */
export function createGraphqlErrorFormatter(isProduction: boolean) {
  return (execution: Execution, context: MercuriusContext) => {
    if (!isProduction) return defaultErrorFormatter(execution, context);

    const errors = execution.errors.map((error) =>
      isInternalFailure(error) ? mask(error) : error,
    );
    return defaultErrorFormatter({ ...execution, errors }, context);
  };
}
