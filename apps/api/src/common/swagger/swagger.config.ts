import { INestApplication } from '@nestjs/common';
import {
  SwaggerModule,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerCustomOptions,
} from '@nestjs/swagger';
import {
  ListResponseDto,
  PageMetaDto,
  PaginationDto,
  ProblemDetailsDto,
  ValidationErrorItemDto,
  ValidationProblemDetailsDto,
} from '@nestjs-fastify-nx/contracts';

const API_TITLE = 'NestJS Fastify Nx Boilerplate';
const API_VERSION = '1.0.0';
const SESSION_COOKIE = 'better-auth.session_token';

const DESCRIPTION = [
  'Production-ready REST + GraphQL API built on NestJS, Fastify and Nx.',
  '',
  '### Authentication',
  `Session-based via [Better Auth](https://better-auth.com). The full auth surface — sign-up, sign-in, sign-out, social providers, password reset, session lookup — is documented in a dedicated reference: **[/api/auth/reference](/api/auth/reference)**.`,
  '',
  `Protected endpoints below require the \`${SESSION_COOKIE}\` cookie. After signing in, click **Authorize** and paste the token value to try them out.`,
  '',
  '### Response shapes',
  '',
  '- **Success** — endpoints return the resource directly (Stripe-style: no envelope). List endpoints return a `ListResponseDto` with `object: "list"`, `data[]`, and `hasMore`.',
  '- **Errors** — every error response uses [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) with `Content-Type: application/problem+json`. Always inspect the `code` field (snake_case, stable) for client-side branching, never the human-readable `title`/`detail`.',
  '- **Validation errors** carry an additional `errors[]` array with one entry per offending field; entries include `path`, `code`, `message`, `rule`, and `constraint`.',
  '',
  '### Correlation',
  '',
  'Every response carries an `X-Request-Id` header (also mirrored as `requestId` in error bodies). Quote it when filing support tickets.',
].join('\n');

export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(DESCRIPTION)
    .setVersion(API_VERSION)
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer('/', 'Current host')
    .addTag('app', 'Service metadata')
    .addTag('health', 'Liveness, readiness, dependency checks')
    .addTag('users', 'Authenticated user profile')
    .addTag('admin', 'Admin-only operations (requires ADMIN role)')
    .addTag('upload', 'File upload')
    .addCookieAuth(
      SESSION_COOKIE,
      {
        type: 'apiKey',
        in: 'cookie',
        name: SESSION_COOKIE,
        description: `Session cookie issued by POST /api/auth/sign-in/email. See [/api/auth/reference](/api/auth/reference).`,
      },
      'session',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    // Globally register cross-cutting schemas so they appear in
    // `components.schemas` even on services that don't reference them by class
    // (Orval, openapi-typescript and friends emit them as named TS types).
    extraModels: [
      ProblemDetailsDto,
      ValidationProblemDetailsDto,
      ValidationErrorItemDto,
      ListResponseDto,
      PageMetaDto,
      PaginationDto,
    ],
  });
}

export function setupSwagger(app: INestApplication): void {
  const document = buildSwaggerDocument(app);

  const options: SwaggerCustomOptions = {
    customSiteTitle: `${API_TITLE} — API Docs`,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      tryItOutEnabled: true,
    },
  };

  SwaggerModule.setup('api/docs', app, document, options);
}
