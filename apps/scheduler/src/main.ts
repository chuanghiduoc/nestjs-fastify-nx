import './tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { reportFatalError, startSentry } from '@nestjs-fastify-nx/infra-observability';
import { AppModule } from './app/app.module';

startSentry({ serviceName: 'nestjs-fastify-scheduler' });

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.get(Logger).log('Scheduler started — cron jobs are active');
}

void bootstrap().catch((error: unknown) => reportFatalError(error, 'nestjs-fastify-scheduler'));
