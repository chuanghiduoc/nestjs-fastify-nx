import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { FEATURE_FLAG_REPOSITORY } from './feature-flag-repository.port';
import { PrismaFeatureFlagRepository } from './prisma-feature-flag.repository';
import { ListFeatureFlagsHandler } from './list-feature-flags';
import { EvaluateFeatureFlagsHandler } from './evaluate-feature-flags';
import { CreateFeatureFlagHandler } from './create-feature-flag';
import { UpdateFeatureFlagHandler } from './update-feature-flag';
import { DeleteFeatureFlagHandler } from './delete-feature-flag';
import { FeatureFlagsController } from './feature-flags.controller';

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
})
export class FeatureFlagsModule {}
