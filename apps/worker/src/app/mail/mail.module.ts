import { Module } from '@nestjs/common';
import { MailAdapter } from './mail.adapter';

@Module({
  providers: [MailAdapter],
  exports: [MailAdapter],
})
export class MailModule {}
