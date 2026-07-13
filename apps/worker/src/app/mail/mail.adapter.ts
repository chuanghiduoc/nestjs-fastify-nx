import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { WorkerEnvConfig } from '../../config/env.validation';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  messageId?: string;
}

@Injectable()
export class MailAdapter implements OnModuleInit {
  private readonly logger = new Logger(MailAdapter.name);
  private transport!: Transporter;
  private from!: string;

  constructor(private readonly config: ConfigService<WorkerEnvConfig, true>) {}

  async onModuleInit(): Promise<void> {
    const user = this.config.get('MAIL_USER', { infer: true });

    this.transport = nodemailer.createTransport({
      host: this.config.get('MAIL_HOST', { infer: true }),
      port: this.config.get('MAIL_PORT', { infer: true }),
      auth: user
        ? {
            user,
            pass: this.config.get('MAIL_PASSWORD', { infer: true }),
          }
        : undefined,
      ignoreTLS: this.config.get('MAIL_IGNORE_TLS', { infer: true }),
      secure: this.config.get('MAIL_SECURE', { infer: true }),
      requireTLS: this.config.get('MAIL_REQUIRE_TLS', { infer: true }),
    });

    const name = this.config.get('MAIL_DEFAULT_NAME', { infer: true });
    const email = this.config.get('MAIL_DEFAULT_EMAIL', { infer: true });
    this.from = `"${name}" <${email}>`;

    // Fail fast in production: a broken SMTP config should surface as a startup
    // error, not as silently-dropped emails. In dev we log and continue so a
    // mailpit restart doesn't block the worker.
    try {
      await this.transport.verify();
      this.logger.log('Mail transport verified');
    } catch (err) {
      const message = `SMTP transport verification failed — ${String(err)}`;
      if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
        throw new Error(message, { cause: err });
      }
      this.logger.warn(message);
    }
  }

  async send(opts: SendMailOptions): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...opts });
  }
}
