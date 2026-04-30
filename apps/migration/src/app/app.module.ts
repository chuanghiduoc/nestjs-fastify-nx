// Migration app bootstraps via main.ts (plain Node — no NestJS HTTP server).
// This file is kept for Nx project structure compatibility only.
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
