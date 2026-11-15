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

    await this.verifyWithRetry();
  }

  private async verifyWithRetry(): Promise<void> {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.transport.verify();
        this.logger.log('Mail transport verified');
        return;
      } catch (err) {
        if (attempt === attempts) {
          this.logger.error(
            { err },
            'SMTP transport verification failed; deliveries will retry through the queue and DLQ',
          );
          return;
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          timer.unref();
        });
      }
    }
  }

  async send(opts: SendMailOptions): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...opts });
  }
}
