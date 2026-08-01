import { Controller, Get, NotFoundException, Param, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import { findErrorTypeDoc } from '@nestjs-fastify-nx/contracts';
import type { FastifyReply } from 'fastify';
import { renderErrorDocPage, renderErrorIndexPage } from './error-docs.page';

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
// The catalog only changes with a deploy, and a client reading it is already handling an error —
// caching keeps that lookup off the critical path.
const CACHE_CONTROL = 'public, max-age=3600';

// Serves the human-readable documentation RFC 9457 §3.1.1 expects a `type` URI to resolve to.
// VERSION_NEUTRAL plus the setGlobalPrefix exclude keep it at `/errors/...`, which is exactly the
// URI the filter already emits — versioning it would turn every `type` into a dead link.
@ApiExcludeController()
@Public()
@Controller({ path: 'errors', version: VERSION_NEUTRAL })
export class ErrorDocsController {
  @Get()
  index(@Res() reply: FastifyReply): void {
    reply.header('Content-Type', HTML_CONTENT_TYPE);
    reply.header('Cache-Control', CACHE_CONTROL);
    reply.send(renderErrorIndexPage());
  }

  @Get(':slug')
  show(@Param('slug') slug: string, @Res() reply: FastifyReply): void {
    const doc = findErrorTypeDoc(slug);
    if (!doc) {
      throw new NotFoundException();
    }

    reply.header('Content-Type', HTML_CONTENT_TYPE);
    reply.header('Cache-Control', CACHE_CONTROL);
    reply.send(renderErrorDocPage(doc));
  }
}
