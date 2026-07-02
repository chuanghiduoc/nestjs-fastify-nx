import { INestApplication, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import {
  ListResponseDto,
  PageMetaDto,
  PaginationDto,
  ProblemDetailsDto,
  ValidationErrorItemDto,
  ValidationProblemDetailsDto,
} from '@nestjs-fastify-nx/contracts';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Converter } from '@apiture/openapi-down-convert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ScalarApiReference from '@scalar/fastify-api-reference';

const API_TITLE = 'NestJS Fastify Nx Boilerplate';
const PROBLEM_JSON = 'application/problem+json';
const SESSION_COOKIE = 'better-auth.session_token';
const DOCS_ROUTE_PREFIX = '/docs';
const REQUEST_ID_HEADER = 'X-Request-Id';
const AUTH_PATH_PREFIX = '/api/auth';
const AUTH_TAG = 'auth';

const logger = new Logger('Swagger');

const DESCRIPTION = [
  'Production-ready REST + GraphQL API built on NestJS, Fastify and Nx.',
  '',
  '### Authentication',
  `Session-based via [Better Auth](https://better-auth.com). Endpoints under \`${AUTH_PATH_PREFIX}/*\` (tagged **${AUTH_TAG}**) cover sign-up, sign-in, sign-out, social providers, password reset and session lookup. Protected resource endpoints require the \`${SESSION_COOKIE}\` cookie — click **Authorize** and paste the value to try them out.`,
  '',
  '### Response shapes',
  '',
  '- **Success** — endpoints return the resource directly (Stripe-style: no envelope). List endpoints return a `ListResponseDto` with `object: "list"`, `data[]`, and `hasMore`.',
  '- **Errors** — every error response uses [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) with `Content-Type: application/problem+json`. Branch on the `code` field (snake_case, stable) — never the human-readable `title`/`detail`.',
  '- **Validation errors** carry an additional `errors[]` array with one entry per offending field; entries include `path`, `code`, `message`, `rule`, and `constraint`.',
  '',
  '### Correlation',
  '',
  `Every response carries an \`${REQUEST_ID_HEADER}\` header (also mirrored as \`requestId\` in error bodies). Quote it when filing support tickets.`,
].join('\n');

// Walks up from cwd looking for package.json — handles `nx serve` (root cwd) and the generated dist/apps/api/package.json from generatePackageJson alike.
function readWorkspaceVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '..', '..', '..', '..', '..', 'package.json'),
    path.join(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

const API_VERSION = readWorkspaceVersion();

const REPOSITORY_URL = 'https://github.com/baotrong/nestjs-fastify-nx';
const SUPPORT_EMAIL = 'hoangproo2624@gmail.com';

function camelCase(input: string): string {
  return input.length === 0 ? input : input[0].toLowerCase() + input.slice(1);
}

export async function buildSwaggerDocument(app: INestApplication): Promise<OpenAPIObject> {
  const builder = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(DESCRIPTION)
    .setVersion(API_VERSION)
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .setContact('API support', REPOSITORY_URL, SUPPORT_EMAIL)
    .setTermsOfService(`${REPOSITORY_URL}/blob/main/LICENSE`)
    .setExternalDoc('Architecture & runbook', `${REPOSITORY_URL}/blob/main/docs/architecture.md`)
    .addServer('/', 'Current host')
    .addTag('app', 'Service metadata')
    .addTag('health', 'Liveness, readiness, dependency checks')
    .addTag(AUTH_TAG, 'Sessions, sign-up, sign-in, password reset (Better Auth)')
    .addTag('users', 'Authenticated user profile')
    .addTag('admin', 'Admin-only operations (requires ADMIN role)')
    .addTag('upload', 'File upload')
    .addCookieAuth(
      SESSION_COOKIE,
      {
        type: 'apiKey',
        in: 'cookie',
        name: SESSION_COOKIE,
        description: `Session cookie issued by POST ${AUTH_PATH_PREFIX}/sign-in/email.`,
      },
      'session',
    );

  const config = builder.build();

  const document = SwaggerModule.createDocument(app, config, {
    // Lower-camelCase keeps Orval method names idiomatic: usersGetProfile, adminUsersList.
    operationIdFactory: (controllerKey, methodKey) => {
      const controller = camelCase(controllerKey.replace(/Controller$/, ''));
      const method = methodKey.charAt(0).toUpperCase() + methodKey.slice(1);
      return `${controller}${method}`;
    },
    extraModels: [
      ProblemDetailsDto,
      ValidationProblemDetailsDto,
      ValidationErrorItemDto,
      ListResponseDto,
      PageMetaDto,
      PaginationDto,
    ],
  });

  await mergeBetterAuthSpec(app, document);
  injectRequestIdResponseHeader(document);
  dedupeOperationIds(document);

  return document;
}

// Better Auth re-uses the same `operationId` across GET/POST variants of the same path. The OpenAPI spec requires uniqueness, and Orval's codegen breaks on collisions — suffix the duplicates with their HTTP method.
function dedupeOperationIds(document: OpenAPIObject): void {
  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const seen = new Set<string>();

  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as
        { operationId?: string } | undefined;
      if (!op?.operationId) continue;

      let id = op.operationId;
      if (seen.has(id)) {
        const methodSuffix = method.charAt(0).toUpperCase() + method.slice(1);
        let candidate = `${id}${methodSuffix}`;
        let counter = 2;
        while (seen.has(candidate)) {
          candidate = `${id}${methodSuffix}${counter++}`;
        }
        id = candidate;
        op.operationId = id;
      }
      seen.add(id);
    }
  }
}

// Better Auth's openAPI() plugin owns its routes outside the Nest pipeline — generateOpenAPISchema() returns the spec we splice into the main document so Orval sees them.
async function mergeBetterAuthSpec(app: INestApplication, document: OpenAPIObject): Promise<void> {
  let auth: BetterAuthInstance | undefined;
  try {
    auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  } catch {
    logger.warn('Better Auth instance not resolvable — skipping auth spec merge');
    return;
  }

  let authSchema: AuthOpenApiDocument | undefined;
  try {
    authSchema = (await auth.api.generateOpenAPISchema()) as AuthOpenApiDocument;
  } catch (err) {
    logger.warn(`Failed to generate Better Auth OpenAPI schema: ${(err as Error).message}`);
    return;
  }

  if (!authSchema) return;

  // Better Auth emits OpenAPI 3.1.1; @nestjs/swagger emits 3.0.0. Down-convert
  // the auth sub-document so every 3.1-only construct is normalised in one pass.
  const converted = new Converter(authSchema, { verbose: false }).convert() as AuthOpenApiDocument;

  if (converted.paths) {
    document.paths = document.paths ?? {};
    for (const [rawPath, pathItem] of Object.entries(converted.paths)) {
      const fullPath = rawPath.startsWith(AUTH_PATH_PREFIX)
        ? rawPath
        : `${AUTH_PATH_PREFIX}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
      const tagged = tagOperations(pathItem, AUTH_TAG) as Record<string, unknown>;
      ensurePathParameters(fullPath, tagged);
      normalizeAuthInfraErrors(tagged);
      document.paths[fullPath] = tagged as (typeof document.paths)[string];
    }
  }

  if (converted.components?.schemas) {
    document.components = document.components ?? {};
    document.components.schemas = {
      ...(document.components.schemas ?? {}),
      ...converted.components.schemas,
    } as NonNullable<typeof document.components.schemas>;
  }
}

interface AuthOpenApiDocument {
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
  [key: string]: unknown;
}

// Better Auth's spec sometimes inlines `{id}` in a path without declaring the parameter. Inject the missing parameter so strict validators (Orval) accept the merged document.
function ensurePathParameters(url: string, pathItem: Record<string, unknown>): void {
  const placeholders = [...url.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (placeholders.length === 0) return;

  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  for (const method of HTTP_METHODS) {
    const op = pathItem[method] as
      { parameters?: Array<{ name?: string; in?: string }> } | undefined;
    if (!op || typeof op !== 'object') continue;
    op.parameters = op.parameters ?? [];
    for (const name of placeholders) {
      const exists = op.parameters.some((p) => p?.name === name && p?.in === 'path');
      if (!exists) {
        op.parameters.push({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        } as { name?: string; in?: string });
      }
    }
  }
}

// Better Auth's generateOpenAPISchema() attaches a generic `{ message }` (application/json)
// error template to every operation. For 429 and 500 that shape is factually wrong on our host:
// /api/auth/* rate-limit rejections come from @fastify/rate-limit and unhandled failures from
// applyFastifyErrorHandler(), both emitting RFC 9457 problem+json — identical to every other
// route. Rewrite just those two so the documented shape matches the real runtime response.
// Better Auth's own 2xx/400/401 semantics are left intact (they genuinely return `{ message }`).
function normalizeAuthInfraErrors(pathItem: Record<string, unknown>): void {
  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const INFRA_CODES: Record<string, string> = {
    '429': 'Rate limit exceeded — see the `Retry-After` response header.',
    '500': 'Unexpected server error. The `requestId` field can be quoted to support.',
  };
  for (const method of HTTP_METHODS) {
    const op = pathItem[method] as { responses?: Record<string, unknown> } | undefined;
    if (!op?.responses) continue;
    for (const [code, description] of Object.entries(INFRA_CODES)) {
      if (!op.responses[code]) continue;
      op.responses[code] = {
        description,
        content: {
          [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
        },
      };
    }
  }
}

// Better Auth's openAPI plugin tags every operation with `Default`. Replace it outright so Orval's `tags-split` mode doesn't emit each operation twice (once under `auth`, once under `default`).
function tagOperations(pathItem: unknown, tag: string): unknown {
  if (!pathItem || typeof pathItem !== 'object') return pathItem;
  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const cloned: Record<string, unknown> = { ...(pathItem as Record<string, unknown>) };
  for (const method of HTTP_METHODS) {
    const op = cloned[method] as { tags?: string[] } | undefined;
    if (op && typeof op === 'object') {
      cloned[method] = { ...op, tags: [tag] };
    }
  }
  return cloned;
}

// X-Request-Id is set on every response by CorrelationIdMiddleware + fastify-error-handler. Document it once globally instead of decorating every controller.
function injectRequestIdResponseHeader(document: OpenAPIObject): void {
  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const headerSpec = {
    description:
      'Correlation id echoed from the request (or freshly minted). Quote when filing support tickets.',
    schema: { type: 'string', format: 'uuid' },
  };

  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as
        { responses?: Record<string, { headers?: Record<string, unknown> }> } | undefined;
      if (!op?.responses) continue;
      for (const response of Object.values(op.responses)) {
        if (!response || typeof response !== 'object') continue;
        response.headers = { ...(response.headers ?? {}), [REQUEST_ID_HEADER]: headerSpec };
      }
    }
  }
}

export async function setupSwagger(app: NestFastifyApplication): Promise<void> {
  const document = await buildSwaggerDocument(app);
  const fastify = app.getHttpAdapter().getInstance();

  // Scalar serves modern, interactive docs at /docs and exposes the raw spec at /docs/openapi.json — Orval reads the disk export from `codegen:full`, not this endpoint.
  await fastify.register(ScalarApiReference, {
    routePrefix: DOCS_ROUTE_PREFIX,
    configuration: {
      content: document,
      metaData: {
        title: `${API_TITLE} — API Docs`,
      },
      hideClientButton: false,
      defaultOpenAllTags: false,
    },
    logLevel: 'warn',
  });

  // /docs-json keeps the legacy contract some clients depend on (CI smoke checks, external doc indexers).
  fastify.get('/docs-json', { logLevel: 'warn' }, async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    return document;
  });

  logger.log(`API docs: Scalar at ${DOCS_ROUTE_PREFIX} (raw JSON at /docs-json)`);
}
