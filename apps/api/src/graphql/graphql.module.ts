import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, type MercuriusDriverConfig } from '@nestjs/mercurius';
import { NoSchemaIntrospectionCustomRule } from 'graphql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import type { EnvConfig } from '../config/env.validation';
import { createGraphqlErrorFormatter } from './graphql-error-formatter';
import { UserResolver } from './resolvers/user.resolver';

@Module({
  imports: [
    GraphQLModule.forRootAsync<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
        return {
          autoSchemaFile: true,
          graphiql: isProduction ? false : 'graphiql',
          path: '/graphql',
          context: (req: FastifyRequest, reply: FastifyReply) => ({ req, reply }),
          validationRules: isProduction ? [NoSchemaIntrospectionCustomRule] : [],
          // Mercurius' default formatter has no production masking, so an unexpected resolver
          // failure would answer with its raw message here while REST answers "Internal Server
          // Error" for the same failure.
          errorFormatter: createGraphqlErrorFormatter(isProduction),
        };
      },
    }),
    UsersModule,
  ],
  providers: [UserResolver],
})
export class GraphqlModule {}
