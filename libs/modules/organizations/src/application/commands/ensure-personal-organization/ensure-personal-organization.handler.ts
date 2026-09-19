import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { generateId } from '@nestjs-fastify-nx/shared';
import { PERSONAL_ORGANIZATION_REPOSITORY } from '../../../domain/ports/personal-organization-repository.port';
import type { PersonalOrganizationRepositoryPort } from '../../../domain/ports/personal-organization-repository.port';
import { EnsurePersonalOrganizationCommand } from './ensure-personal-organization.command';

@CommandHandler(EnsurePersonalOrganizationCommand)
export class EnsurePersonalOrganizationHandler implements ICommandHandler<
  EnsurePersonalOrganizationCommand,
  string
> {
  constructor(
    @Inject(PERSONAL_ORGANIZATION_REPOSITORY)
    private readonly organizations: PersonalOrganizationRepositoryPort,
  ) {}

  async execute({ userId }: EnsurePersonalOrganizationCommand): Promise<string> {
    const organizationId = await this.organizations.findFirstOrganizationId(userId);
    if (organizationId) return organizationId;

    const user = await this.organizations.findUserIdentity(userId);
    const name = user.name.trim() || user.email.split('@')[0];
    const slug = `ws-${generateId().replace(/-/g, '')}`;
    return this.organizations.createIfAbsent(userId, name, slug);
  }
}
