import { beforeEach, describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';
import { Term, TERM_TYPE } from '../domain/entities/term.entity';
import type { TermRepositoryPort } from '../domain/ports/term-repository.port';
import { InMemoryTermRepository } from '../testing/in-memory-term-repository';
import { ListPublishedTermsHandler } from './queries/list-published-terms/list-published-terms.handler';
import { GetLatestTermHandler } from './queries/get-latest-term/get-latest-term.handler';
import { GetLatestTermQuery } from './queries/get-latest-term/get-latest-term.query';
import { ListMyTermAcceptancesHandler } from './queries/list-my-term-acceptances/list-my-term-acceptances.handler';
import { ListMyTermAcceptancesQuery } from './queries/list-my-term-acceptances/list-my-term-acceptances.query';
import { CreateTermHandler } from './commands/create-term/create-term.handler';
import { CreateTermCommand } from './commands/create-term/create-term.command';
import { PublishTermHandler } from './commands/publish-term/publish-term.handler';
import { PublishTermCommand } from './commands/publish-term/publish-term.command';
import { AcceptTermHandler } from './commands/accept-term/accept-term.handler';
import { AcceptTermCommand } from './commands/accept-term/accept-term.command';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef91300001';

function bindAll(repository: InMemoryTermRepository): TermRepositoryPort {
  return {
    findPublished: () => repository.findPublished(),
    findLatestPublished: (type) => repository.findLatestPublished(type),
    findById: (id) => repository.findById(id),
    create: (term) => repository.create(term),
    publish: (id, publishedAt) => repository.publish(id, publishedAt),
    recordAcceptance: (input) => repository.recordAcceptance(input),
    findAcceptances: (userId) => repository.findAcceptances(userId),
  };
}

describe('Term entity', () => {
  it('rejects a malformed version label', () => {
    expect(() =>
      Term.create({ type: TERM_TYPE.TERMS_OF_SERVICE, version: '-nope', content: 'body' }),
    ).toThrow(DomainException);
  });

  it('keeps the original publication date when published twice', () => {
    const first = new Date('2026-08-01T00:00:00.000Z');
    const term = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
      publishedAt: first,
    });

    expect(term.publishedAtOrNow(new Date('2026-09-01T00:00:00.000Z')).publishedAt).toEqual(first);
  });
});

describe('term handlers', () => {
  let repository: InMemoryTermRepository;

  beforeEach(() => {
    repository = new InMemoryTermRepository();
  });

  it('creates a draft that is not published', async () => {
    const created = await new CreateTermHandler(repository).execute(
      new CreateTermCommand({
        type: TERM_TYPE.TERMS_OF_SERVICE,
        version: 'v1',
        content: 'body',
      }),
    );

    expect(created.publishedAt).toBeNull();
  });

  it('creates and publishes in one call when asked', async () => {
    const created = await new CreateTermHandler(repository).execute(
      new CreateTermCommand({
        type: TERM_TYPE.PRIVACY_POLICY,
        version: 'v1',
        content: 'body',
        publish: true,
      }),
    );

    expect(created.publishedAt).toBeInstanceOf(Date);
  });

  it('lists published versions only', async () => {
    repository.seed(
      Term.create({ type: TERM_TYPE.TERMS_OF_SERVICE, version: 'draft', content: 'body' }),
    );
    repository.seed(
      Term.create({
        type: TERM_TYPE.TERMS_OF_SERVICE,
        version: 'live',
        content: 'body',
        publishedAt: new Date(),
      }),
    );

    const result = await new ListPublishedTermsHandler(repository).execute();

    expect(result.data.map((term) => term.version)).toEqual(['live']);
  });

  it('returns the newest published version of a type', async () => {
    repository.seed(
      Term.create({
        type: TERM_TYPE.TERMS_OF_SERVICE,
        version: 'old',
        content: 'body',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    repository.seed(
      Term.create({
        type: TERM_TYPE.TERMS_OF_SERVICE,
        version: 'new',
        content: 'body',
        publishedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );

    const latest = await new GetLatestTermHandler(repository).execute(
      new GetLatestTermQuery(TERM_TYPE.TERMS_OF_SERVICE),
    );

    expect(latest.version).toBe('new');
  });

  it('answers not_found when no version of a type is published', async () => {
    const execute = new GetLatestTermHandler(repository).execute(
      new GetLatestTermQuery(TERM_TYPE.COOKIE_POLICY),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('publishes a draft', async () => {
    const term = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
    });
    repository.seed(term);

    const published = await new PublishTermHandler(repository).execute(
      new PublishTermCommand(term.id),
    );

    expect(published.publishedAt).toBeInstanceOf(Date);
    expect((await repository.findById(term.id))?.isPublished).toBe(true);
  });

  it('publishing twice keeps the first date', async () => {
    const publishedAt = new Date('2026-08-01T00:00:00.000Z');
    const term = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
      publishedAt,
    });
    repository.seed(term);

    const republished = await new PublishTermHandler(repository).execute(
      new PublishTermCommand(term.id),
    );

    expect(republished.publishedAt).toEqual(publishedAt);
  });

  it('reports the stored date when a concurrent publish won the compare-and-set', async () => {
    const draft = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
    });
    repository.seed(draft);
    const winnerPublishedAt = new Date('2026-08-01T00:00:00.000Z');
    const racingRepository: TermRepositoryPort = {
      ...bindAll(repository),
      publish: async (id, publishedAt) => {
        await repository.publish(id, winnerPublishedAt);
        expect(publishedAt).not.toEqual(winnerPublishedAt);
        return false;
      },
    };

    const published = await new PublishTermHandler(racingRepository).execute(
      new PublishTermCommand(draft.id),
    );

    expect(published.publishedAt).toEqual(winnerPublishedAt);
  });

  it('answers not_found when publishing an unknown id', async () => {
    const execute = new PublishTermHandler(repository).execute(
      new PublishTermCommand(generateId()),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('records an acceptance of a published version', async () => {
    const term = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
      publishedAt: new Date(),
    });
    repository.seed(term);

    await new AcceptTermHandler(repository).execute(
      new AcceptTermCommand(USER_ID, term.id, '203.0.113.7'),
    );

    const acceptances = await new ListMyTermAcceptancesHandler(repository).execute(
      new ListMyTermAcceptancesQuery(USER_ID),
    );
    expect(acceptances.data).toHaveLength(1);
    expect(acceptances.data[0].version).toBe('v1');
  });

  it('keeps the first timestamp when the same version is accepted twice', async () => {
    const term = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
      publishedAt: new Date(),
    });
    repository.seed(term);
    const handler = new AcceptTermHandler(repository);
    await handler.execute(new AcceptTermCommand(USER_ID, term.id, null));
    const first = (
      await new ListMyTermAcceptancesHandler(repository).execute(
        new ListMyTermAcceptancesQuery(USER_ID),
      )
    ).data[0].acceptedAt;

    await handler.execute(new AcceptTermCommand(USER_ID, term.id, null));

    const after = await new ListMyTermAcceptancesHandler(repository).execute(
      new ListMyTermAcceptancesQuery(USER_ID),
    );
    expect(after.data).toHaveLength(1);
    expect(after.data[0].acceptedAt).toEqual(first);
  });

  it('refuses to accept an unpublished version', async () => {
    const term = Term.create({
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'draft',
      content: 'body',
    });
    repository.seed(term);

    const execute = new AcceptTermHandler(repository).execute(
      new AcceptTermCommand(USER_ID, term.id, null),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('answers not_found when accepting an unknown version', async () => {
    const execute = new AcceptTermHandler(repository).execute(
      new AcceptTermCommand(USER_ID, generateId(), null),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });
});
