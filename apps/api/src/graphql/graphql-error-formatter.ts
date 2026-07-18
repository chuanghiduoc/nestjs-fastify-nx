import { HttpException, HttpStatus } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { defaultErrorFormatter } from 'mercurius';
import type { MercuriusContext } from 'mercurius';
import type { ExecutionResult } from 'graphql';

// Matches the REST detail the global filter returns for an unexpected failure.
const MASKED_MESSAGE = 'Internal server error';

type Execution = ExecutionResult & Required<Pick<ExecutionResult, 'errors'>>;

/**
 * Mirrors GlobalExceptionFilter's REST rule: an error that is not an HttpException — or is a 5xx
 * one — was not deliberately raised for the client, and its message can carry driver or internal
 * detail. A GraphQL-level error (syntax, validation) has no `originalError`; it only describes the
 * query the client itself sent, so it stays verbatim.
 */
function isInternalFailure(error: GraphQLError): boolean {
  const original = error.originalError;
  if (!original) return false;
  if (original instanceof HttpException) {
    return original.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR;
  }
  return true;
}

// Rebuilt rather than mutated: GraphQLError.message is readonly. `originalError` is deliberately
// dropped — carrying it forward would put the message straight back into the serialized error.
// Locations and path survive so the client can still tell which field failed.
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
 * masking, so without this an unexpected failure inside a resolver answers a GraphQL client with the
 * raw message while the same failure over REST answers "Internal Server Error".
 *
 * Masking happens before delegating: the default formatter serializes eagerly (`toJSON()`) and
 * flattens nested validation errors, so after it runs there is no `originalError` left to judge by
 * and no stable index to map back to. Nothing is lost from the logs — GlobalExceptionFilter already
 * logs the full error and reports it to Sentry before re-throwing it into this path.
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
