import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra/database';
import { MessagingModule } from '@nestjs-fastify-nx/infra/messaging';
import { FEATURE_FLAG_REPOSITORY } from './domain/ports/feature-flag-repository.port';
import { PrismaFeatureFlagRepository } from './infrastructure/repositories/prisma-feature-flag.repository';
import { ListFeatureFlagsHandler } from './application/queries/list-feature-flags';
import { EvaluateFeatureFlagsHandler } from './application/queries/evaluate-feature-flags';
import { CreateFeatureFlagHandler } from './application/commands/create-feature-flag';
import { UpdateFeatureFlagHandler } from './application/commands/update-feature-flag';
import { DeleteFeatureFlagHandler } from './application/commands/delete-feature-flag';
import { FeatureFlagsController } from './presentation/controllers/feature-flags.controller';

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [FeatureFlagsController],
  providers: [
    { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
    ListFeatureFlagsHandler,
    EvaluateFeatureFlagsHandler,
    CreateFeatureFlagHandler,
    UpdateFeatureFlagHandler,
    DeleteFeatureFlagHandler,
  ],
  exports: [FEATURE_FLAG_REPOSITORY],
})
export class FeatureFlagsModule {}
