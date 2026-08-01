import { Module } from '@nestjs/common';
import { ErrorDocsController } from './error-docs.controller';

@Module({
  controllers: [ErrorDocsController],
})
export class ErrorDocsModule {}
