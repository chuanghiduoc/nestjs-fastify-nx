import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { UserResolver } from './resolvers/user.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: true,
      // Mercurius serves the GraphQL endpoint at `path` and (when graphiql is
      // truthy) the IDE at `/graphiql`. Disabled in prod to keep the schema
      // surface minimal — introspection still works for authenticated clients.
      graphiql: process.env['NODE_ENV'] !== 'production' ? 'graphiql' : false,
      path: '/graphql',
      context: (req, reply) => ({ req, reply }),
    }),
    UsersModule,
  ],
  providers: [UserResolver],
})
export class GraphqlModule {}
