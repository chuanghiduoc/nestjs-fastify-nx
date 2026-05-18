import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { NoSchemaIntrospectionCustomRule } from 'graphql';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { UserResolver } from './resolvers/user.resolver';

const isProduction = process.env['NODE_ENV'] === 'production';

@Module({
  imports: [
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: true,
      // GraphiQL IDE only in dev. In prod, `NoSchemaIntrospectionCustomRule`
      // makes the validator reject any `__schema` / `__type` field so the
      // schema cannot be enumerated even by authenticated clients — they
      // should consume the generated libs/api-client instead.
      graphiql: isProduction ? false : 'graphiql',
      path: '/graphql',
      context: (req, reply) => ({ req, reply }),
      validationRules: isProduction ? [NoSchemaIntrospectionCustomRule] : [],
    }),
    UsersModule,
  ],
  providers: [UserResolver],
})
export class GraphqlModule {}
