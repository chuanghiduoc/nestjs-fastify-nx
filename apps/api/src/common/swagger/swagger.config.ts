import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  buildProblemExample,
  ListResponseDto,
  ProblemDetailsDto,
  ValidationErrorItemDto,
  ValidationProblemDetailsDto,
} from '@nestjs-fastify-nx/contracts';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ScalarApiReference from '@scalar/fastify-api-reference';

const API_TITLE = 'NestJS Fastify Nx Boilerplate';
const PROBLEM_JSON = 'application/problem+json';
const SESSION_COOKIE_BASE = 'better-auth.session_token';
const DOCS_ROUTE_PREFIX = '/docs';
const REQUEST_ID_HEADER = 'X-Request-Id';
const AUTH_PATH_PREFIX = '/api/auth';
const AUTH_TAG = 'auth';

// Credential paths that create a session (no auth required yet). Better Auth's generated spec marks
// them as secured — strip that so they aren't documented as needing a token.
const PUBLIC_AUTH_PATHS = new Set([
  `${AUTH_PATH_PREFIX}/sign-in/email`,
  `${AUTH_PATH_PREFIX}/sign-up/email`,
  `${AUTH_PATH_PREFIX}/request-password-reset`,
  `${AUTH_PATH_PREFIX}/reset-password`,
  `${AUTH_PATH_PREFIX}/forget-password`,
]);

const logger = new Logger('Swagger');

// Better Auth adds `__Secure-` to the cookie name when it issues secure cookies (production, or any
// https baseURL). setupSwagger runs off-production, so resolve the real name for the https-staging
// case rather than hardcoding — the Authorize field must match the cookie actually sent.
function resolveSessionCookieName(): string {
  const secure =
    process.env['NODE_ENV'] === 'production' ||
    (process.env['BETTER_AUTH_URL'] ?? '').startsWith('https://');
  return secure ? `__Secure-${SESSION_COOKIE_BASE}` : SESSION_COOKIE_BASE;
}

function buildDescription(sessionCookie: string): string {
  return [
    'Production-ready REST + GraphQL API built on NestJS, Fastify and Nx.',
    '',
    '### Authentication',
    `Session-based via [Better Auth](https://better-auth.com). Endpoints under \`${AUTH_PATH_PREFIX}/*\` (tagged **${AUTH_TAG}**) cover sign-up, sign-in, sign-out, social providers, password reset and session lookup. Protected resource endpoints require the \`${sessionCookie}\` cookie — click **Authorize** and paste the value to try them out.`,
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
}

// OpenAPI contract version — deliberately decoupled from the package release
// version. `nx release` bumps package.json on every release; tying the spec to
// it would regenerate the entire api-client (orval) on each bump for a no-op
// comment change. This only moves on a breaking REST contract change, which
// also introduces a new URI version (/api/v2). Matches the URI default "1".
const API_VERSION = '1.0.0';

function camelCase(input: string): string {
  return input.length === 0 ? input : input[0].toLowerCase() + input.slice(1);
}

export async function buildSwaggerDocument(app: INestApplication): Promise<OpenAPIObject> {
  const sessionCookie = resolveSessionCookieName();
  const builder = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(buildDescription(sessionCookie))
    .setVersion(API_VERSION)
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer('/', 'Current host')
    .addTag('app', 'Service metadata')
    .addTag('health', 'Liveness, readiness, dependency checks')
    .addTag(AUTH_TAG, 'Sessions, sign-up, sign-in, password reset (Better Auth)')
    .addTag('users', 'Authenticated user profile')
    .addTag('admin', 'Admin-only operations (requires ADMIN role)')
    .addTag('upload', 'File upload')
    .addCookieAuth(
      sessionCookie,
      {
        type: 'apiKey',
        in: 'cookie',
        name: sessionCookie,
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
    // Only models referenced by $ref that Nest can't auto-discover: the problem-details shapes and
    // the generic list envelope (composed via allOf in ApiPaginatedResponse). The offset PaginationDto
    // is a query DTO (inlined per-endpoint), so registering it here would only emit a dead schema.
    extraModels: [
      ProblemDetailsDto,
      ValidationProblemDetailsDto,
      ValidationErrorItemDto,
      ListResponseDto,
    ],
  });

  await mergeBetterAuthSpec(app, document);
  injectRequestIdResponseHeader(document);
  dedupeOperationIds(document);

  return document;
}

// Better Auth re-uses the same `operationId` across GET/POST variants of the same path. The OpenAPI spec requires uniqueness, and Orval's codegen breaks on collisions — suffix the duplicates with their HTTP method.
function dedupeOperationIds(document: OpenAPIObject): void {
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
    authSchema = await auth.api.generateOpenAPISchema();
  } catch (err) {
    logger.warn(`Failed to generate Better Auth OpenAPI schema: ${(err as Error).message}`);
    return;
  }

  if (!authSchema) return;

  // Better Auth emits OpenAPI 3.1.1; @nestjs/swagger emits 3.0.0. Down-convert
  // the auth sub-document so every 3.1-only construct is normalised in one pass.
  // Loaded lazily: @apiture/openapi-down-convert is a devDependency (docs/codegen only). A
  // top-level import would crash the production image on boot because the generated runtime
  // package omits it — setupSwagger never runs in production, so this path is dev/codegen-only.
  const { Converter } = await import(/* webpackIgnore: true */ '@apiture/openapi-down-convert');
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
      assignMissingOperationIds(fullPath, tagged);
      applyCookieOnlySecurity(fullPath, tagged);
      document.paths[fullPath] = tagged;
    }
  }

  if (converted.components?.schemas) {
    document.components = document.components ?? {};
    document.components.schemas = {
      ...(document.components.schemas ?? {}),
      ...converted.components.schemas,
    } as NonNullable<typeof document.components.schemas>;
  }

  // Deliberately DO NOT merge Better Auth's securitySchemes (`bearerAuth`, `apiKeyCookie`).
  // applyCookieOnlySecurity rewrites every auth operation to reference our `session` cookie scheme,
  // so those schemes would be unreferenced — and merging `bearerAuth` would advertise an access-token
  // flow this repo does not use (auth is the `better-auth.session_token` cookie, never a bearer token).
}

interface AuthOpenApiDocument {
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
  [key: string]: unknown;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

// Better Auth leaves many merged operations without an operationId. Orval then falls back to ugly
// path-derived names (getApiAuthRevokeSession…), inconsistent with the clean names elsewhere. Derive
// a camelCase id from the path segments after /api/auth so codegen method names stay idiomatic;
// collisions across GET/POST are resolved afterwards by dedupeOperationIds.
function assignMissingOperationIds(fullPath: string, pathItem: Record<string, unknown>): void {
  const segments = fullPath
    .replace(new RegExp(`^${AUTH_PATH_PREFIX}/?`), '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/\{|\}/g, ''));
  const base = segments
    .map((segment, index) =>
      segment
        .split(/[-_]/)
        .map((part, partIndex) =>
          index === 0 && partIndex === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
        )
        .join(''),
    )
    .join('');
  if (!base) return;

  for (const method of HTTP_METHODS) {
    const op = pathItem[method] as { operationId?: string } | undefined;
    if (op && typeof op === 'object' && !op.operationId) {
      op.operationId = base;
    }
  }
}

// Better Auth's generated spec blanket-marks every operation with `bearerAuth` (access-token flow).
// This repo authenticates auth routes with the `better-auth.session_token` COOKIE, never a bearer
// token, so advertising bearer would contradict the auth contract (and the "NOT JWT" invariant).
// Rewrite each merged auth operation to the cookie `session` scheme — public credential routes
// (sign-in/up, password reset) need no session, so they get an empty requirement.
function applyCookieOnlySecurity(fullPath: string, pathItem: Record<string, unknown>): void {
  const isPublic = PUBLIC_AUTH_PATHS.has(fullPath);
  for (const method of HTTP_METHODS) {
    const op = pathItem[method] as { security?: unknown } | undefined;
    if (op && typeof op === 'object') op.security = isPublic ? [] : [{ session: [] }];
  }
}

// Better Auth's spec sometimes inlines `{id}` in a path without declaring the parameter. Inject the missing parameter so strict validators (Orval) accept the merged document.
function ensurePathParameters(url: string, pathItem: Record<string, unknown>): void {
  const placeholders = [...url.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (placeholders.length === 0) return;

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
// GlobalExceptionFilter, both emitting RFC 9457 problem+json — identical to every other
// route. Rewrite just those two so the documented shape matches the real runtime response.
// Better Auth's own 2xx/400/401 semantics are left intact (they genuinely return `{ message }`).
function normalizeAuthInfraErrors(pathItem: Record<string, unknown>): void {
  const INFRA_RESPONSES: Record<string, { code: string; title: string; detail: string }> = {
    '429': {
      code: 'rate_limited',
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded — see the `Retry-After` response header.',
    },
    '500': {
      code: 'internal_server_error',
      title: 'Internal Server Error',
      detail: 'Unexpected server error. Quote the `requestId` field when contacting support.',
    },
  };
  for (const method of HTTP_METHODS) {
    const op = pathItem[method] as { responses?: Record<string, unknown> } | undefined;
    if (!op?.responses) continue;
    for (const [code, cfg] of Object.entries(INFRA_RESPONSES)) {
      if (!op.responses[code]) continue;
      op.responses[code] = {
        description: cfg.detail,
        content: {
          [PROBLEM_JSON]: {
            schema: { $ref: '#/components/schemas/ProblemDetailsDto' },
            // Explicit example so the tab shows a 429/500 body, not the schema's default 404 example.
            example: buildProblemExample({ status: Number(code), ...cfg }),
          },
        },
      };
    }
  }
}

// Better Auth's openAPI plugin tags every operation with `Default`. Replace it outright so Orval's `tags-split` mode doesn't emit each operation twice (once under `auth`, once under `default`).
function tagOperations(pathItem: unknown, tag: string): unknown {
  if (!pathItem || typeof pathItem !== 'object') return pathItem;
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
  const headerSpec = {
    description:
      'Correlation id echoed from the request (or freshly minted). Quote when filing support tickets.',
    // Not `format: uuid`: the value is a 32-hex OTel trace id or a `randomBytes(16)` hex string
    // (no dashes) — a strict validator would reject those against the uuid format.
    schema: { type: 'string', example: '4bf92f3577b34da6a3ce929d0e0e4736' },
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
