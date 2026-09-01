import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, openAPI, organization } from 'better-auth/plugins';
import type { PrismaClient } from '@nestjs-fastify-nx/infra-database';
import type { I18nService } from 'nestjs-i18n';
import { resolveRequestLocale, translateOrFallback } from '@nestjs-fastify-nx/infra-i18n';
import { usesSecureCookies } from './session-cookie';
import { organizationAccessControl, organizationRoles } from './organization-access-control';
import { I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import {
  EMAIL_TEMPLATES,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
  USER_STATUS,
  generateId,
  type EmailTemplate,
} from '@nestjs-fastify-nx/shared';
export interface AuthMailDispatcher {
  send(opts: {
    to: string;
    subject: string;
    body: string;
    templateId?: EmailTemplate;
  }): Promise<void>;
}

const logger = new Logger('BetterAuth');

const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 48;

const SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
const SESSION_COOKIE_CACHE_MAX_AGE_SECONDS = 5 * 60;

export async function ensurePersonalOrganization(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const membership = await prisma.member.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
  });
  if (membership) return membership.organizationId;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const name = user.name.trim() || user.email.split('@')[0];

  // The first membership check is the common fast path. The per-user transaction lock closes the
  // concurrent sign-in race across processes without deriving a slug from the user id.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
    const existing = await tx.member.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    if (existing) return existing.organizationId;

    const organization = await tx.organization.create({
      data: { name, slug: `ws-${generateId().replace(/-/g, '')}` },
      select: { id: true },
    });
    await tx.member.create({
      data: { organizationId: organization.id, userId, role: SYSTEM_ROLES.OWNER },
      select: { id: true },
    });
    return organization.id;
  });
}

type OAuthCredentials = { clientId: string; clientSecret: string };

// Returns a provider's OAuth pair only when BOTH id and secret are set, so a
// half-configured provider stays disabled rather than failing at request time.
function readOAuthPair(prefix: string): OAuthCredentials | undefined {
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

// Enables only the social providers whose credentials are present. Each provider
// is opt-in via env — no env means the provider is simply absent from the config.
export function buildSocialProviders(): NonNullable<BetterAuthOptions['socialProviders']> {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {};
  const google = readOAuthPair('GOOGLE');
  if (google) providers.google = google;
  const github = readOAuthPair('GITHUB');
  if (github) providers.github = github;
  const facebook = readOAuthPair('FACEBOOK');
  if (facebook) providers.facebook = facebook;
  return providers;
}

export function createBetterAuth(
  prisma: PrismaClient,
  mail: AuthMailDispatcher,
  i18n: I18nService,
) {
  const secret = process.env['BETTER_AUTH_SECRET'];
  const baseURL = process.env['BETTER_AUTH_URL'];
  const frontendBase = resolveFrontendBase();
  const trustedOrigins =
    process.env['CORS_ORIGINS']
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  if (!secret) {
    // Defence in depth — env.validation already rejects an unset secret in prod,
    // but throw here too so any bypass (overridden ConfigModule, tests) still fails loud.
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('BETTER_AUTH_SECRET must be set in production');
    }
    logger.warn('BETTER_AUTH_SECRET unset — sessions reset on every restart');
  }
  if (trustedOrigins.length === 0) {
    logger.warn('CORS_ORIGINS empty — cross-origin session cookies will be rejected');
  }

  const socialProviders = buildSocialProviders();
  const enabledProviders = Object.keys(socialProviders);
  if (enabledProviders.length > 0) {
    logger.log(`Social login enabled: ${enabledProviders.join(', ')}`);
  }

  return betterAuth({
    ...(secret ? { secret } : {}),
    ...(baseURL ? { baseURL } : {}),
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    ...(enabledProviders.length > 0 ? { socialProviders } : {}),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, token }, request) => {
        const lang = resolveRequestLocale(request);
        const link = `${frontendBase}/reset?token=${encodeURIComponent(token)}`;
        const subject = await translateOrFallback(i18n, I18N_KEYS.emails.password_reset.subject, {
          lang,
        });
        const body = await renderPasswordResetEmail(i18n, lang, { name: user.name, link });
        await mail.send({
          to: user.email,
          subject,
          body,
          templateId: EMAIL_TEMPLATES.PASSWORD_RESET,
        });
      },
    },
    emailVerification: {
      // requireEmailVerification omitted — blocking unverified sign-in is a product decision.
      sendVerificationEmail: async ({ user, token }, request) => {
        const lang = resolveRequestLocale(request);
        const link = `${frontendBase}/verify-email?token=${encodeURIComponent(token)}`;
        const subject = await translateOrFallback(
          i18n,
          I18N_KEYS.emails.email_verification.subject,
          { lang },
        );
        const body = await renderEmailVerificationEmail(i18n, lang, { name: user.name, link });
        await mail.send({
          to: user.email,
          subject,
          body,
          templateId: EMAIL_TEMPLATES.EMAIL_VERIFICATION,
        });
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_MAX_AGE_SECONDS,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const organizationId = await ensurePersonalOrganization(prisma, session.userId);
            return { data: { ...session, activeOrganizationId: organizationId } };
          },
        },
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: PLATFORM_ROLES.USER, input: false },
        status: { type: 'string', defaultValue: USER_STATUS.ACTIVE, input: false },
      },
      changeEmail: {
        enabled: true,
        // Require control of the current verified mailbox before Better Auth sends the
        // verification message to the new address. A stolen session cookie alone is insufficient.
        sendChangeEmailConfirmation: async ({ user, newEmail, token }, request) => {
          const lang = resolveRequestLocale(request);
          const link = `${frontendBase}/verify-email?token=${encodeURIComponent(token)}`;
          const subject = await translateOrFallback(i18n, I18N_KEYS.emails.email_change.subject, {
            lang,
          });
          const body = await renderEmailChangeConfirmation(i18n, lang, {
            name: user.name,
            newEmail,
            link,
          });
          await mail.send({
            to: user.email,
            subject,
            body,
            templateId: EMAIL_TEMPLATES.EMAIL_CHANGE_CONFIRMATION,
          });
        },
      },
      // Email confirmation required — without it a stolen cookie deletes the account in one POST.
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, token }, request) => {
          const lang = resolveRequestLocale(request);
          const link = `${frontendBase}/delete-account?token=${encodeURIComponent(token)}`;
          const subject = await translateOrFallback(
            i18n,
            I18N_KEYS.emails.account_deletion.subject,
            { lang },
          );
          const body = await renderAccountDeletionEmail(i18n, lang, { name: user.name, link });
          await mail.send({
            to: user.email,
            subject,
            body,
            templateId: EMAIL_TEMPLATES.ACCOUNT_DELETION,
          });
        },
      },
    },
    account: {
      // OAuth access/refresh/id tokens are credentials. Better Auth stores them as plaintext
      // unless encryption is explicitly enabled.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Better Auth already links matching accounts when the provider confirms the email.
        // Do not use trustedProviders here: it bypasses that provider verification signal.
      },
    },
    trustedOrigins,
    advanced: {
      database: { generateId: false }, // Postgres owns PKs via uuidv7() — B-tree friendly.
      // Secure whenever the app is served over HTTPS — keyed on the baseURL protocol, NOT NODE_ENV
      // alone, so an HTTPS staging/preview deploy (NODE_ENV != production) still gets Secure +
      // __Secure-. httpOnly + SameSite=Lax are Better Auth defaults; SameSite=None (cross-site) is a
      // deployment-topology call left to the operator.
      useSecureCookies: usesSecureCookies(baseURL),
    },
    // bearer() lets non-browser clients (WebSocket, mobile, service-to-service) authenticate with
    // `Authorization: Bearer <session-token>`. Better Auth verifies the token signature and maps it
    // to the correctly-named session cookie (incl. the __Secure- prefix under useSecureCookies),
    // which a hand-rolled synthetic cookie can't do reliably.
    plugins: [
      openAPI(),
      bearer(),
      organization({
        teams: { enabled: true },
        // Without ac/roles the dynamic role endpoints only know Better Auth's own statements, so a
        // tenant could not create a role granting this app's permissions (file:*, audit_log:*)
        // even though PostgresPbacAdapter resolves exactly those from organization_roles.
        ac: organizationAccessControl,
        roles: organizationRoles,
        dynamicAccessControl: { enabled: true },
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data, request) => {
          const lang = resolveRequestLocale(request);
          const link = `${frontendBase}/accept-invitation?id=${encodeURIComponent(data.id)}`;
          const subject = await translateOrFallback(
            i18n,
            I18N_KEYS.emails.organization_invitation.subject,
            { lang, args: { organization: data.organization.name } },
          );
          const body = await renderOrganizationInvitationEmail(i18n, lang, {
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name || data.inviter.user.email,
            role: data.role,
            expiresAt: data.invitation.expiresAt,
            link,
          });
          await mail.send({
            to: data.email,
            subject,
            body,
            templateId: EMAIL_TEMPLATES.ORGANIZATION_INVITATION,
          });
        },
      }),
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

// FRONTEND_BASE_URL required in production — falling back to API origin means email links 404 in a browser.
export function resolveFrontendBase(): string {
  const raw = process.env['FRONTEND_BASE_URL']?.trim();
  if (raw) return raw.replace(/\/+$/, '');

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'FRONTEND_BASE_URL must be set in production — it is the SPA host that owns ' +
        '/reset, /verify-email and /delete-account pages. Email links cannot be ' +
        'built without it.',
    );
  }

  // BETTER_AUTH_URL is optional outside production and ships empty in .env.example, so this cannot
  // just read it: an empty origin makes every email link relative, which no mail client can follow
  // and which assertHttpLink rejects outright. Fall through to this process's own origin instead.
  const configured = process.env['BETTER_AUTH_URL']?.trim().replace(/\/+$/, '');
  const apiOrigin = configured || `http://localhost:${process.env['PORT']?.trim() || '3000'}`;
  logger.warn(
    `FRONTEND_BASE_URL not set; falling back to API origin "${apiOrigin}" for dev. ` +
      'Email reset/verify/delete links will 404 in a browser — configure the SPA host before going live.',
  );
  return apiOrigin;
}

// One layout for every transactional email: the four templates differed only in their paragraphs,
// so the markup, the inline style and the escaping rule were maintained in four places.
function emailLayout(paragraphs: readonly string[]): string {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n');
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
${body}
</body></html>`;
}

// Links are the only interpolation that is a URL rather than translated copy.
function linkParagraph(link: string): string {
  const escaped = escapeHtml(assertHttpLink(link));
  return `<a href="${escaped}">${escaped}</a>`;
}

async function greeting(
  i18n: I18nService,
  lang: string,
  namespaceKeys: { greeting: string; greeting_named: string },
  name?: string,
): Promise<string> {
  if (name) {
    return translateOrFallback(i18n, namespaceKeys.greeting_named, {
      lang,
      args: { name: escapeHtml(name) },
    });
  }
  return translateOrFallback(i18n, namespaceKeys.greeting, { lang });
}

async function renderPasswordResetEmail(
  i18n: I18nService,
  lang: string,
  ctx: { name?: string; link: string },
): Promise<string> {
  const keys = I18N_KEYS.emails.password_reset;
  const [hello, lead, ignore] = await Promise.all([
    greeting(i18n, lang, keys, ctx.name),
    translateOrFallback(i18n, keys.lead, { lang }),
    translateOrFallback(i18n, keys.ignore, { lang }),
  ]);
  return emailLayout([hello, lead, linkParagraph(ctx.link), ignore]);
}

async function renderEmailVerificationEmail(
  i18n: I18nService,
  lang: string,
  ctx: { name?: string; link: string },
): Promise<string> {
  const keys = I18N_KEYS.emails.email_verification;
  const [hello, lead, expiry] = await Promise.all([
    greeting(i18n, lang, keys, ctx.name),
    translateOrFallback(i18n, keys.lead, { lang }),
    translateOrFallback(i18n, keys.expiry, { lang }),
  ]);
  return emailLayout([hello, lead, linkParagraph(ctx.link), expiry]);
}

async function renderEmailChangeConfirmation(
  i18n: I18nService,
  lang: string,
  ctx: { name?: string; newEmail: string; link: string },
): Promise<string> {
  const keys = I18N_KEYS.emails.email_change;
  const [hello, lead, target, notYou] = await Promise.all([
    greeting(i18n, lang, keys, ctx.name),
    translateOrFallback(i18n, keys.lead, { lang }),
    translateOrFallback(i18n, keys.target, {
      lang,
      args: { newEmail: escapeHtml(ctx.newEmail) },
    }),
    translateOrFallback(i18n, keys.not_you, { lang }),
  ]);
  return emailLayout([hello, lead, target, linkParagraph(ctx.link), notYou]);
}

async function renderOrganizationInvitationEmail(
  i18n: I18nService,
  lang: string,
  ctx: {
    organizationName: string;
    inviterName: string;
    role: string;
    expiresAt: Date;
    link: string;
  },
): Promise<string> {
  const keys = I18N_KEYS.emails.organization_invitation;
  const [hello, lead, role, accept, expiry] = await Promise.all([
    greeting(i18n, lang, keys, undefined),
    translateOrFallback(i18n, keys.lead, {
      lang,
      args: {
        inviter: escapeHtml(ctx.inviterName),
        organization: escapeHtml(ctx.organizationName),
      },
    }),
    translateOrFallback(i18n, keys.role, { lang, args: { role: escapeHtml(ctx.role) } }),
    translateOrFallback(i18n, keys.accept, { lang }),
    translateOrFallback(i18n, keys.expiry, {
      lang,
      args: { expiresAt: ctx.expiresAt.toISOString() },
    }),
  ]);
  return emailLayout([hello, lead, role, accept, linkParagraph(ctx.link), expiry]);
}

async function renderAccountDeletionEmail(
  i18n: I18nService,
  lang: string,
  ctx: { name?: string; link: string },
): Promise<string> {
  const keys = I18N_KEYS.emails.account_deletion;
  const [hello, warning, confirm, notYou] = await Promise.all([
    greeting(i18n, lang, keys, ctx.name),
    translateOrFallback(i18n, keys.warning, { lang }),
    translateOrFallback(i18n, keys.confirm, { lang }),
    translateOrFallback(i18n, keys.not_you, { lang }),
  ]);
  return emailLayout([hello, warning, confirm, linkParagraph(ctx.link), notYou]);
}

const EMAIL_LINK_PROTOCOLS = new Set(['http:', 'https:']);

// escapeHtml guards the href's quoting, NOT its scheme: `javascript:...` contains none of the five
// escaped characters and would survive intact. FRONTEND_BASE_URL is operator-controlled, so the
// scheme is the one part of an email link that no escaping downstream can make safe — reject it
// here instead. The link carries a single-use token, so it must never reach the message.
export function assertHttpLink(link: string): string {
  let protocol: string;
  try {
    protocol = new URL(link).protocol;
  } catch {
    throw new Error('Refusing to embed an unparseable link in an email — check FRONTEND_BASE_URL');
  }
  if (!EMAIL_LINK_PROTOCOLS.has(protocol)) {
    throw new Error(
      `Refusing to embed a "${protocol}" link in an email — check FRONTEND_BASE_URL (http/https only)`,
    );
  }
  return link;
}

// Escapes the five characters that can break out of HTML text or a quoted attribute. Scheme safety
// for hrefs is assertHttpLink's job, not this function's.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
