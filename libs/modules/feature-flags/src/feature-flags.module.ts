import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { FEATURE_FLAG_REPOSITORY } from './domain/ports/feature-flag-repository.port';
import { PrismaFeatureFlagRepository } from './infrastructure/repositories/prisma-feature-flag.repository';
import { ListFeatureFlagsHandler } from './application/queries/list-feature-flags/list-feature-flags.handler';
import { EvaluateFeatureFlagsHandler } from './application/queries/evaluate-feature-flags/evaluate-feature-flags.handler';
import { CreateFeatureFlagHandler } from './application/commands/create-feature-flag/create-feature-flag.handler';
import { UpdateFeatureFlagHandler } from './application/commands/update-feature-flag/update-feature-flag.handler';
import { DeleteFeatureFlagHandler } from './application/commands/delete-feature-flag/delete-feature-flag.handler';
import { FeatureFlagsController } from './presentation/controllers/feature-flags.controller';

@Module({
  imports: [DatabaseModule],
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
