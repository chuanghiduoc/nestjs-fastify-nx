import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
import type { PrismaClient } from '@nestjs-fastify-nx/infra-database';
import type { I18nService } from 'nestjs-i18n';
import {
  I18N_KEYS,
  resolveRequestLocale,
  translateOrFallback,
} from '@nestjs-fastify-nx/infra-i18n';
export interface AuthMailDispatcher {
  send(opts: { to: string; subject: string; body: string; templateId?: string }): Promise<void>;
}

const logger = new Logger('BetterAuth');

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
          templateId: 'password-reset',
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
          templateId: 'email-verification',
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'USER', input: false },
        status: { type: 'string', defaultValue: 'ACTIVE', input: false },
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
            templateId: 'email-change-confirmation',
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
            templateId: 'account-deletion',
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
    },
    plugins: [openAPI()],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

// FRONTEND_BASE_URL required in production — falling back to API origin means email links 404 in a browser.
function resolveFrontendBase(): string {
  const raw = process.env['FRONTEND_BASE_URL']?.trim();
  if (raw) return raw.replace(/\/+$/, '');

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'FRONTEND_BASE_URL must be set in production — it is the SPA host that owns ' +
        '/reset, /verify-email and /delete-account pages. Email links cannot be ' +
        'built without it.',
    );
  }

  const apiOrigin = process.env['BETTER_AUTH_URL']?.replace(/\/+$/, '') ?? '';
  logger.warn(
    `FRONTEND_BASE_URL not set; falling back to API origin "${apiOrigin}" for dev. ` +
      'Email reset/verify/delete links will 404 in a browser — configure the SPA host before going live.',
  );
  return apiOrigin;
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
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${hello}</p>
<p>${lead}</p>
<p><a href="${ctx.link}">${ctx.link}</a></p>
<p>${ignore}</p>
</body></html>`;
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
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${hello}</p>
<p>${lead}</p>
<p><a href="${ctx.link}">${ctx.link}</a></p>
<p>${expiry}</p>
</body></html>`;
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
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${hello}</p>
<p>${lead}</p>
<p>${target}</p>
<p><a href="${ctx.link}">${ctx.link}</a></p>
<p>${notYou}</p>
</body></html>`;
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
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${hello}</p>
<p>${warning}</p>
<p>${confirm}</p>
<p><a href="${ctx.link}">${ctx.link}</a></p>
<p>${notYou}</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
