import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
import type { PrismaClient } from '@prisma/client';

export interface AuthMailDispatcher {
  send(opts: { to: string; subject: string; body: string; templateId?: string }): Promise<void>;
}

const logger = new Logger('BetterAuth');

export function createBetterAuth(prisma: PrismaClient, mail: AuthMailDispatcher) {
  const secret = process.env['BETTER_AUTH_SECRET'];
  const baseURL = process.env['BETTER_AUTH_URL'];
  const frontendBase = resolveFrontendBase();
  const trustedOrigins =
    process.env['CORS_ORIGINS']
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  if (!secret) {
    logger.warn('BETTER_AUTH_SECRET unset — sessions reset on every restart');
  }
  if (trustedOrigins.length === 0) {
    logger.warn('CORS_ORIGINS empty — cross-origin session cookies will be rejected');
  }

  return betterAuth({
    ...(secret ? { secret } : {}),
    ...(baseURL ? { baseURL } : {}),
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, token }) => {
        const link = `${frontendBase}/reset?token=${encodeURIComponent(token)}`;
        await mail.send({
          to: user.email,
          subject: 'Reset your password',
          body: passwordResetTemplate({ name: user.name, link }),
          templateId: 'password-reset',
        });
      },
    },
    emailVerification: {
      // requireEmailVerification omitted — blocking unverified sign-in is a product decision.
      sendVerificationEmail: async ({ user, token }) => {
        const link = `${frontendBase}/verify-email?token=${encodeURIComponent(token)}`;
        await mail.send({
          to: user.email,
          subject: 'Verify your email',
          body: emailVerificationTemplate({ name: user.name, link }),
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
      changeEmail: { enabled: true },
      // Email confirmation required — without it a stolen cookie deletes the account in one POST.
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, token }) => {
          const link = `${frontendBase}/delete-account?token=${encodeURIComponent(token)}`;
          await mail.send({
            to: user.email,
            subject: 'Confirm account deletion',
            body: accountDeletionTemplate({ name: user.name, link }),
            templateId: 'account-deletion',
          });
        },
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

function passwordResetTemplate({ name, link }: { name?: string; link: string }): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${greeting}</p>
<p>We received a request to reset your password. Click the link below to choose a new one:</p>
<p><a href="${link}">${link}</a></p>
<p>If you did not request this, you can safely ignore this email — your password will stay the same. The link expires in 1 hour.</p>
</body></html>`;
}

function emailVerificationTemplate({ name, link }: { name?: string; link: string }): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${greeting}</p>
<p>Please confirm your email address by clicking the link below:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours.</p>
</body></html>`;
}

function accountDeletionTemplate({ name, link }: { name?: string; link: string }): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${greeting}</p>
<p>We received a request to delete your account. This action is permanent.</p>
<p>If you really want to proceed, confirm via this link:</p>
<p><a href="${link}">${link}</a></p>
<p>If this was not you, change your password immediately.</p>
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
